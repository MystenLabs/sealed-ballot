# Sealed Ballot

Private, threshold-encrypted voting on Sui, powered by
[Seal](https://github.com/MystenLabs/seal).

<p align="center">
  <img src="docs/sealed-ballot.jpg" width="360"
       alt="Cartoon seal in a sailor hat at a harbourside voting booth, dropping a marked ballot into the box." />
</p>

**▶ Try it: <https://seal-voting.vercel.app>**

## What it does

- Anyone can create a vote with a title, a set of named options, a whitelist of eligible voter
  addresses, and a voting duration.
- Each whitelisted voter casts a single **encrypted** vote. Votes are threshold-encrypted with Seal
  and stored on-chain, so nobody can see how anyone voted while the vote is open.
- The vote is **finalized** once every voter has voted, or once the deadline passes, whichever comes
  first. Finalizing fetches the Seal decryption keys and submits them, and the votes are decrypted
  and tallied **on-chain**. Voters who missed the deadline are simply not counted.

> **Privacy model:** this is a *sealed ballot*. Votes are secret only until the reveal. Finalizing
> publishes the decryption keys on-chain, so at that point the individual votes are revealed too,
> not just the aggregate tally.

## Trying it

1. Set your Sui wallet to **Testnet** and fund it from the [faucet](https://faucet.sui.io/).
2. Open the app and connect your wallet.
3. Create a vote, listing a couple of addresses you control as the eligible voters.
4. Cast a vote from each of those addresses.
5. Finalize to decrypt and reveal the tally.

Every transaction on a vote is linked from its page, so you can follow the whole flow on the
explorer as it happens.

## Under the hood

This is the [`voting` on-chain-decryption pattern](https://github.com/MystenLabs/seal/blob/main/move/patterns/sources/voting.move)
from the Seal repository, wrapped in a small React UI. A voter's chosen option is encrypted against
two Mysten Labs "Open" mode Testnet key servers with a threshold of 2-of-2, and their address is
bound into the ciphertext so nobody else can replay it. Finalizing submits the key servers' derived
keys to `finalize_vote`, which verifies them and does the decryption and the tally in Move.

- **Move package (Testnet):** `0x697ebf7687482d27f0da83b9733cc1c39773ad48ae97c7a31fb7c9135bfe4251`
- **Seal package (Testnet):** `0xdccbeb87767be2b2346af5575eb139807205e4c23ec53dc616f951fe1d814112`

## Running it locally

```bash
cd app
pnpm install
pnpm dev
```

`pnpm test` runs the whole flow headlessly against Testnet with a throwaway keypair.

## License

Apache-2.0
