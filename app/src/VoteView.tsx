// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useCurrentAccount, useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react';
import { useQuery } from '@tanstack/react-query';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { fromHex, normalizeSuiAddress } from '@mysten/sui/utils';
import { DemType, SessionKey } from '@mysten/seal';
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Link as RLink,
  Progress,
  Separator,
  Text,
} from '@radix-ui/themes';
import { CheckCircledIcon, CircleIcon } from '@radix-ui/react-icons';
import { MODULE, PACKAGE_ID } from './constants';
import { makeSealClient } from './seal';
import { fetchVoteTransactions } from './graphql';
import type { VoteTransaction } from './graphql';
import { explorerObjectUrl, explorerTxUrl, parseVote, shorten, unwrapTransaction } from './utils';

const SESSION_TTL_MIN = 10;

export function VoteView() {
  const { id } = useParams();
  const account = useCurrentAccount();
  const packageId = PACKAGE_ID;
  const suiClient = useCurrentClient();
  const dAppKit = useDAppKit();

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    data: vote,
    isPending,
    error: loadError,
    refetch,
  } = useQuery({
    queryKey: ['vote', id],
    enabled: !!id,
    refetchInterval: 3000,
    queryFn: async () => {
      const { object } = await suiClient.getObject({
        objectId: id!,
        include: { json: true, type: true },
      });
      return parseVote(object);
    },
  });

  const { data: activity } = useQuery({
    queryKey: ['voteTransactions', id],
    enabled: !!id,
    refetchInterval: 5000,
    queryFn: () => fetchVoteTransactions(id!),
  });

  // Sign, execute and wait for a transaction, throwing on an on-chain failure.
  async function execute(tx: Transaction) {
    const { effects } = unwrapTransaction(
      await dAppKit.signAndExecuteTransaction({ transaction: tx }),
    );
    await suiClient.waitForTransaction({ digest: effects.transactionDigest });
  }

  if (isPending) {
    return (
      <Card>
        <Text color="gray">Loading vote…</Text>
      </Card>
    );
  }

  if (loadError || !vote) {
    return (
      <Card>
        <Callout.Root color="red">
          <Callout.Text>
            {loadError
              ? `Could not load ${shorten(id ?? '')}: ${loadError.message}`
              : `${shorten(id ?? '')} is not a vote from this package.`}
          </Callout.Text>
        </Callout.Root>
      </Card>
    );
  }

  const myAddress = account?.address ? normalizeSuiAddress(account.address) : null;
  const myIndex = vote.voters.findIndex((v) => normalizeSuiAddress(v) === myAddress);
  const isVoter = myIndex >= 0;
  const iHaveVoted = isVoter && vote.voted[myIndex];
  const castCount = vote.voted.filter(Boolean).length;
  const allVoted = castCount === vote.voters.length;
  const deadlinePassed = Date.now() >= vote.endTimeMs;
  // A vote can be finalized once everyone has voted, or once the deadline has passed.
  const canFinalize = !vote.isFinalized && (allVoted || deadlinePassed);

  // Cast an encrypted vote for the given option index.
  async function castVote(optionIndex: number) {
    if (!account) return;
    setError(null);
    setBusy('Encrypting and casting your vote…');
    try {
      const sealClient = makeSealClient(suiClient);
      const innerId = vote!.id.slice(2); // hex id without the 0x prefix
      const { encryptedObject } = await sealClient.encrypt({
        threshold: vote!.threshold,
        packageId,
        id: innerId,
        data: new Uint8Array([optionIndex]),
        // The voter's address as additional authenticated data binds this ciphertext to the voter,
        // so it cannot be replayed by anyone else.
        aad: fromHex(account.address),
        // The voting pattern decrypts on-chain, which requires the Hmac256Ctr DEM.
        demType: DemType.Hmac256Ctr,
      });

      const tx = new Transaction();
      tx.moveCall({
        target: `${packageId}::${MODULE}::cast_vote`,
        arguments: [
          tx.object(vote!.id),
          tx.pure.vector('u8', Array.from(encryptedObject)),
          tx.object.clock(),
        ],
      });
      tx.setGasBudget(100000000);

      await execute(tx);
      setBusy(null);
      refetch();
    } catch (e) {
      setBusy(null);
      setError(String(e));
    }
  }

  // Fetch the Seal derived keys and submit them so the votes are decrypted and tallied on-chain.
  async function finalize() {
    if (!account) return;
    setError(null);
    setBusy('Requesting decryption keys…');
    try {
      const sealClient = makeSealClient(suiClient);
      const innerId = vote!.id.slice(2);
      const sessionKey = await SessionKey.create({
        address: account.address,
        packageId,
        ttlMin: SESSION_TTL_MIN,
        suiClient,
      });

      const { signature } = await dAppKit.signPersonalMessage({
        message: sessionKey.getPersonalMessage(),
      });
      await sessionKey.setPersonalMessageSignature(signature);

      // Build the seal_approve PTB the key servers evaluate before releasing keys.
      const approveTx = new Transaction();
      approveTx.moveCall({
        target: `${packageId}::${MODULE}::seal_approve`,
        arguments: [
          approveTx.pure.vector('u8', fromHex(innerId)),
          approveTx.object(vote!.id),
          approveTx.object.clock(),
        ],
      });
      const txBytes = await approveTx.build({ client: suiClient, onlyTransactionKind: true });

      const derivedKeys = await sealClient.getDerivedKeys({
        id: innerId,
        txBytes,
        sessionKey,
        threshold: vote!.threshold,
      });

      // Order the derived keys to match the vote's key_servers field.
      const normalized = new Map(
        Array.from(derivedKeys.entries()).map(([ks, dk]) => [normalizeSuiAddress(ks), dk]),
      );
      const orderedServers: string[] = [];
      const orderedKeys: number[][] = [];
      for (const ks of vote!.keyServers) {
        const dk = normalized.get(normalizeSuiAddress(ks));
        if (dk) {
          orderedServers.push(ks);
          orderedKeys.push(Array.from(fromHex(dk.toString())));
        }
      }
      if (orderedServers.length < vote!.threshold) {
        throw new Error('Could not obtain enough derived keys from the key servers.');
      }

      setBusy('Finalizing on-chain…');
      const tx = new Transaction();
      tx.moveCall({
        target: `${packageId}::${MODULE}::finalize_vote`,
        arguments: [
          tx.object(vote!.id),
          tx.pure(bcs.vector(bcs.vector(bcs.u8())).serialize(orderedKeys).toBytes()),
          tx.pure.vector('address', orderedServers),
        ],
      });
      tx.setGasBudget(100000000);

      await execute(tx);
      setBusy(null);
      refetch();
    } catch (e) {
      setBusy(null);
      setError(String(e));
    }
  }

  const totalVotes = vote.result ? vote.result.reduce((a, b) => a + b, 0) : 0;
  const winningIndex =
    vote.result && totalVotes > 0
      ? vote.result.indexOf(Math.max(...vote.result))
      : -1;

  return (
    <Flex direction="column" gap="4">
      <Card>
        <Flex justify="between" align="start">
          <Box>
            <Heading size="5">{vote.title || '(untitled)'}</Heading>
            <Text size="1" color="gray">
              <RLink href={explorerObjectUrl(vote.id)} target="_blank">
                {shorten(vote.id)}
              </RLink>{' '}
              · created by {shorten(vote.creator)}
            </Text>
          </Box>
          {vote.isFinalized ? (
            <Badge color="green">Finalized</Badge>
          ) : canFinalize ? (
            <Badge color="amber">Ready to finalize</Badge>
          ) : (
            <Badge color="blue">Open</Badge>
          )}
        </Flex>
      </Card>

      {error && (
        <Callout.Root color="red">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}
      {busy && (
        <Callout.Root color="blue">
          <Callout.Text>{busy}</Callout.Text>
        </Callout.Root>
      )}

      {/* Voting / results panel */}
      <Card>
        {vote.isFinalized && vote.result ? (
          <Box>
            <Heading size="4" mb="3">
              Results
            </Heading>
            <Flex direction="column" gap="3">
              {vote.options.map((opt, i) => {
                const count = vote.result![i];
                const pct = totalVotes > 0 ? (count / totalVotes) * 100 : 0;
                return (
                  <Box key={i}>
                    <Flex justify="between" mb="1">
                      <Text weight={i === winningIndex ? 'bold' : 'regular'}>
                        {opt} {i === winningIndex && totalVotes > 0 ? '👑' : ''}
                      </Text>
                      <Text color="gray">
                        {count} vote{count === 1 ? '' : 's'}
                      </Text>
                    </Flex>
                    <Progress value={pct} />
                  </Box>
                );
              })}
            </Flex>
            <Text size="1" color="gray" mt="3" as="div">
              {totalVotes} valid vote{totalVotes === 1 ? '' : 's'} counted out of {vote.voters.length}{' '}
              voter{vote.voters.length === 1 ? '' : 's'}.
            </Text>
          </Box>
        ) : isVoter && !iHaveVoted && !deadlinePassed ? (
          <Box>
            <Heading size="4" mb="3">
              Cast your vote
            </Heading>
            <Text size="2" color="gray" as="div" mb="3">
              Your choice is encrypted before it is sent on-chain. It stays secret while the vote is
              open; finalizing then decrypts and reveals every vote on-chain.
            </Text>
            <Flex direction="column" gap="2">
              {vote.options.map((opt, i) => (
                <Button
                  key={i}
                  size="3"
                  variant="surface"
                  disabled={!!busy}
                  onClick={() => castVote(i)}
                >
                  {opt}
                </Button>
              ))}
            </Flex>
          </Box>
        ) : (
          <Box>
            <Heading size="4" mb="2">
              {iHaveVoted ? 'You have voted' : 'Voting'}
            </Heading>
            <Text size="2" color="gray" as="div">
              {iHaveVoted
                ? 'Your encrypted vote has been recorded.'
                : isVoter
                  ? 'Voting closed before you cast a vote, so yours is not counted.'
                  : 'Your connected wallet is not on this vote’s whitelist.'}
            </Text>
            {!vote.isFinalized && (
              <Box mt="3">
                <Text size="2" as="div" mb="1">
                  {castCount} of {vote.voters.length} voters have voted.
                </Text>
                <Text size="2" color="gray" as="div" mb="2">
                  {deadlinePassed
                    ? 'Voting deadline has passed.'
                    : `Voting ends ${new Date(vote.endTimeMs).toLocaleString()}.`}
                </Text>
                <Button size="3" disabled={!canFinalize || !!busy} onClick={finalize}>
                  {canFinalize
                    ? allVoted
                      ? 'Finalize & reveal result'
                      : 'Finalize now (deadline passed)'
                    : 'Waiting for all votes or deadline…'}
                </Button>
              </Box>
            )}
          </Box>
        )}
      </Card>

      {/* Voter roster */}
      <Card>
        <Heading size="3" mb="2">
          Voters ({castCount}/{vote.voters.length} voted)
        </Heading>
        <Separator size="4" mb="2" />
        <Flex direction="column" gap="1">
          {vote.voters.map((v, i) => (
            <Flex key={v} justify="between" align="center">
              <Text size="2">
                {shorten(v, 8)}
                {normalizeSuiAddress(v) === myAddress ? ' (you)' : ''}
              </Text>
              {vote.voted[i] ? (
                <Flex align="center" gap="1" style={{ color: 'var(--green-11)' }}>
                  <CheckCircledIcon /> <Text size="1">voted</Text>
                </Flex>
              ) : (
                <Flex align="center" gap="1" style={{ color: 'var(--gray-9)' }}>
                  <CircleIcon /> <Text size="1">pending</Text>
                </Flex>
              )}
            </Flex>
          ))}
        </Flex>
      </Card>

      {/* On-chain history: every transaction that touched this vote. */}
      <Card>
        <Heading size="3" mb="2">
          Transactions
        </Heading>
        <Separator size="4" mb="2" />
        {!activity?.length ? (
          <Text size="2" color="gray">
            No transactions found. The public indexer only keeps about a month of history.
          </Text>
        ) : (
          <Flex direction="column" gap="2">
            {activity.map((tx) => (
              <Flex key={tx.digest} justify="between" align="center" gap="3">
                <Flex direction="column" gap="1" style={{ minWidth: 0 }}>
                  <Flex align="center" gap="2">
                    <Text size="2">{transactionLabel(tx)}</Text>
                    {!tx.succeeded && (
                      <Badge color="red" size="1">
                        failed
                      </Badge>
                    )}
                  </Flex>
                  <Text size="1" color="gray">
                    {tx.sender ? shorten(tx.sender, 6) : 'unknown sender'}
                    {tx.sender && normalizeSuiAddress(tx.sender) === myAddress ? ' (you)' : ''}
                    {tx.timestampMs ? ` · ${new Date(tx.timestampMs).toLocaleString()}` : ''}
                  </Text>
                </Flex>
                <RLink href={explorerTxUrl(tx.digest)} target="_blank" size="1">
                  {shorten(tx.digest, 6)}
                </RLink>
              </Flex>
            ))}
          </Flex>
        )}
      </Card>
    </Flex>
  );
}

/** A human-readable name for the `voting` function a transaction called. */
function transactionLabel(tx: VoteTransaction): string {
  switch (tx.function) {
    case 'create_vote':
      return 'Vote created';
    case 'cast_vote':
      return 'Encrypted vote cast';
    case 'finalize_vote':
      return 'Finalized: votes revealed and tallied';
    default:
      return 'Other transaction';
  }
}
