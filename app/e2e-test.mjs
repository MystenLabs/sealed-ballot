// Headless end-to-end test of the seal_voting on-chain decryption flow.
// Uses a fresh ephemeral keypair funded from the testnet faucet (no wallet keys touched).
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { requestSuiFromFaucetV2, getFaucetHost } from '@mysten/sui/faucet';
import { fromHex, normalizeSuiAddress } from '@mysten/sui/utils';
import { bcs } from '@mysten/sui/bcs';
import { SealClient, SessionKey, DemType } from '@mysten/seal';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const KEYFILE = '/tmp/seal_voting_ephem.key';

const PACKAGE_ID = '0x08307012638003b7df2372d486755df193653875bde5193c13eb8e03663dd952';
const KEY_SERVER_IDS = [
  '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75',
  '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8',
];
const THRESHOLD = 2;

const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' });
const kp = existsSync(KEYFILE)
  ? Ed25519Keypair.fromSecretKey(readFileSync(KEYFILE, 'utf8').trim())
  : new Ed25519Keypair();
if (!existsSync(KEYFILE)) writeFileSync(KEYFILE, kp.getSecretKey());
const addr = kp.getPublicKey().toSuiAddress();
console.log('ephemeral voter:', addr);

const exec = async (tx) => {
  tx.setGasBudget(100000000);
  const res = await client.signAndExecuteTransaction({
    transaction: tx,
    signer: kp,
    options: { showEffects: true, showObjectChanges: true },
  });
  await client.waitForTransaction({ digest: res.digest });
  if (res.effects.status.status !== 'success') {
    throw new Error('tx failed: ' + JSON.stringify(res.effects.status));
  }
  return res;
};

let bal = BigInt((await client.getBalance({ owner: addr })).totalBalance);
if (bal === 0n) {
  console.log('requesting faucet (may be rate-limited)...');
  try {
    await requestSuiFromFaucetV2({ host: getFaucetHost('testnet'), recipient: addr });
    for (let i = 0; i < 30; i++) {
      bal = BigInt((await client.getBalance({ owner: addr })).totalBalance);
      if (bal > 0n) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch (e) {
    console.log('faucet failed:', e.message);
  }
}
if (bal === 0n) {
  console.log(`\nNo balance. Fund this address then re-run:\n  ${addr}\n`);
  process.exit(2);
}
console.log('balance:', bal.toString());

const seal = new SealClient({
  suiClient: client,
  serverConfigs: KEY_SERVER_IDS.map((objectId) => ({ objectId, weight: 1 })),
  verifyKeyServers: false,
});
const servers = await seal.getKeyServers();
const pks = KEY_SERVER_IDS.map((id) => Array.from(servers.get(id).pk));

// 1. create vote
let tx = new Transaction();
tx.moveCall({
  target: `${PACKAGE_ID}::voting::create_vote`,
  arguments: [
    tx.pure.address(PACKAGE_ID),
    tx.pure.string('headless test'),
    tx.pure.vector('address', [addr]),
    tx.pure.vector('string', ['Alpha', 'Beta']),
    tx.pure.vector('address', KEY_SERVER_IDS),
    tx.pure(bcs.vector(bcs.vector(bcs.u8())).serialize(pks).toBytes()),
    tx.pure.u8(THRESHOLD),
  ],
});
let res = await exec(tx);
const voteId = res.objectChanges.find(
  (c) => c.type === 'created' && c.objectType.endsWith('::voting::Vote'),
).objectId;
console.log('vote created:', voteId);

// 2. cast encrypted vote for option index 1 (Beta)
const innerId = voteId.slice(2);
const { encryptedObject } = await seal.encrypt({
  threshold: THRESHOLD,
  packageId: PACKAGE_ID,
  id: innerId,
  data: new Uint8Array([1]),
  aad: fromHex(addr),
  // The voting pattern decrypts on-chain, which requires the Hmac256Ctr DEM.
  demType: DemType.Hmac256Ctr,
});
tx = new Transaction();
tx.moveCall({
  target: `${PACKAGE_ID}::voting::cast_vote`,
  arguments: [tx.object(voteId), tx.pure.vector('u8', Array.from(encryptedObject))],
});
await exec(tx);
console.log('vote cast (Beta)');

// 3. finalize: derive keys + submit
const sessionKey = await SessionKey.create({
  address: addr,
  packageId: PACKAGE_ID,
  ttlMin: 10,
  signer: kp,
  suiClient: client,
});
const approveTx = new Transaction();
approveTx.moveCall({
  target: `${PACKAGE_ID}::voting::seal_approve`,
  arguments: [approveTx.pure.vector('u8', fromHex(innerId)), approveTx.object(voteId)],
});
const txBytes = await approveTx.build({ client, onlyTransactionKind: true });
const derivedKeys = await seal.getDerivedKeys({ id: innerId, txBytes, sessionKey, threshold: THRESHOLD });
const norm = new Map(
  Array.from(derivedKeys.entries()).map(([k, v]) => [normalizeSuiAddress(k), v]),
);
const orderedServers = [];
const orderedKeys = [];
for (const ks of KEY_SERVER_IDS) {
  const dk = norm.get(normalizeSuiAddress(ks));
  if (dk) {
    orderedServers.push(ks);
    orderedKeys.push(Array.from(fromHex(dk.toString())));
  }
}
console.log('derived keys obtained:', orderedServers.length);

tx = new Transaction();
tx.moveCall({
  target: `${PACKAGE_ID}::voting::finalize_vote`,
  arguments: [
    tx.object(voteId),
    tx.pure(bcs.vector(bcs.vector(bcs.u8())).serialize(orderedKeys).toBytes()),
    tx.pure.vector('address', orderedServers),
  ],
});
await exec(tx);

// 4. read & assert
const obj = await client.getObject({ id: voteId, options: { showContent: true } });
const f = obj.data.content.fields;
const result = (f.result?.fields?.vec?.[0] ?? f.result?.vec?.[0] ?? f.result ?? []).map(Number);
console.log('is_finalized:', f.is_finalized);
console.log('result tally [Alpha, Beta]:', JSON.stringify(result));
const ok = f.is_finalized === true && result.length === 2 && result[0] === 0 && result[1] === 1;
console.log(ok ? '\n✅ E2E PASSED: Beta got 1 vote, Alpha 0.' : '\n❌ E2E FAILED');
process.exit(ok ? 0 : 1);
