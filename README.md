# Seal Voting

A demo app for **private, threshold-encrypted voting** on Sui, powered by
[Seal](https://github.com/MystenLabs/seal).

- Anyone can create a vote with a **title**, a set of **named options**, and a **whitelist** of
  eligible voter addresses.
- Each whitelisted voter submits a single **encrypted** vote (the option they chose). Votes are
  threshold-encrypted with Seal and stored on-chain — nobody can see how anyone voted.
- Once **every** whitelisted voter has voted, anyone can **finalize** the vote: the Seal key servers
  release the derived keys, and the votes are **decrypted and tallied on-chain**. Individual votes
  are never revealed; only the aggregate result is.

This is built on the [`voting` on-chain-decryption pattern](https://github.com/MystenLabs/seal/blob/main/move/patterns/sources/voting.move)
from the Seal repository, adapted into a deployable demo with a small React UI.

> Deployed on **Sui Testnet**. Seal's verified key servers run on Testnet/Mainnet (not Devnet),
> so the demo targets Testnet.

## Deployment

- **Move package (Testnet):** `0x08307012638003b7df2372d486755df193653875bde5193c13eb8e03663dd952`
- **Seal package (Testnet):** `0xdcb3015886d0d12430d82d7c3274b4fafdb2c7fa2bcdbfac468c15a11a1d1f5a` —
  an optimized build of Seal with a faster `decrypt` (see the `seal` dependency in
  `move/seal_voting/Move.toml`).
- **Key servers:** the two Mysten Labs "Open" mode independent Testnet key servers, with a
  threshold of 2-of-2 (see `app/src/constants.ts`).

## Project layout

```
move/seal_voting/      Move package (the Vote object + create/cast/finalize/seal_approve)
app/                   Vite + React frontend (@mysten/dapp-kit + @mysten/seal)
app/e2e-test.mjs       Headless end-to-end test of the full encrypt → cast → finalize flow
```

## Run the frontend locally

```bash
cd app
pnpm install
pnpm dev
```

Open the printed URL, connect a Sui wallet set to **Testnet**, and fund it from the
[faucet](https://faucet.sui.io/). Create a vote (add a couple of addresses you control as voters),
cast votes from each, then finalize to reveal the tally.

## Deploy to Vercel

The frontend is a static SPA. Import this repo into Vercel and set:

- **Root Directory:** `app`
- Build command / output are picked up from `app/vercel.json` (`pnpm build` → `dist`, with an SPA
  rewrite).

## How the Seal integration works

- **Encrypt:** `SealClient.encrypt({ packageId, id: <voteId>, threshold, data: [optionIndex], aad: <voter>, demType: Hmac256Ctr })`.
  The voter's address is the `aad`, binding the ciphertext to that voter. The on-chain decryption
  path requires the **Hmac256Ctr** DEM.
- **Cast:** `cast_vote` verifies the ciphertext's key servers, threshold, vote id, package id, and
  `aad` before recording it.
- **Finalize:** the app builds a `seal_approve` PTB (which only passes once all voters have voted),
  calls `SealClient.getDerivedKeys(...)` to obtain the key servers' derived keys, and submits them
  to `finalize_vote`, which verifies the keys and decrypts/tallies the votes on-chain.

## Rebuild / redeploy the Move package

```bash
cd move/seal_voting
sui move build
sui client publish --gas-budget 200000000
```

Then update `PACKAGE_ID` in `app/src/constants.ts` with the new package id.

> **Note:** the package id Seal uses for key derivation is the package's **original (first) id**.
> The deployed package id is stored on each `Vote` at creation and used for encryption and on-chain
> verification, so the package should not be upgraded between creating and finalizing votes.

## Headless test

`app/e2e-test.mjs` runs the entire flow against Testnet with a fresh ephemeral keypair (funded via
faucet). From `app/`: `node e2e-test.mjs`.

## License

Apache-2.0
