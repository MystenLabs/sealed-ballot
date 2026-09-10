// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
import { bcs } from '@mysten/sui/bcs';
import type { SuiClientTypes } from '@mysten/sui/client';

type ExecutionStatus = SuiClientTypes.ExecutionStatus;

/** `sui::group_ops::Element<T>`, which wraps a single `bytes: vector<u8>` field. */
const Element = bcs.vector(bcs.u8());

/**
 * BCS layout of `seal::bf_hmac_encryption::EncryptedObject`, one encrypted vote as it is stored
 * on chain. Note this is the Move struct, which is not the same shape as the `EncryptedObject`
 * wire format that `@mysten/seal` exports.
 */
const EncryptedObject = bcs.struct('EncryptedObject', {
  packageId: bcs.Address,
  id: bcs.vector(bcs.u8()),
  indices: bcs.vector(bcs.u8()),
  services: bcs.vector(bcs.Address),
  threshold: bcs.u8(),
  nonce: Element,
  encryptedShares: bcs.vector(bcs.vector(bcs.u8())),
  encryptedRandomness: bcs.vector(bcs.u8()),
  blob: bcs.vector(bcs.u8()),
  aad: bcs.option(bcs.vector(bcs.u8())),
  mac: bcs.vector(bcs.u8()),
});

/**
 * BCS layout of the on-chain `seal_voting::voting::Vote` struct.
 *
 * The gRPC API returns object contents as the BCS bytes of the Move struct rather than as
 * pre-parsed JSON, so the layout has to be mirrored here field for field, in declaration order.
 */
const VoteStruct = bcs.struct('Vote', {
  id: bcs.Address,
  creator: bcs.Address,
  packageId: bcs.Address,
  title: bcs.string(),
  voters: bcs.vector(bcs.Address),
  options: bcs.vector(bcs.string()),
  votes: bcs.vector(bcs.option(EncryptedObject)),
  endTimeMs: bcs.u64(),
  isFinalized: bcs.bool(),
  result: bcs.option(bcs.vector(bcs.u64())),
  keyServers: bcs.vector(bcs.Address),
  publicKeys: bcs.vector(bcs.vector(bcs.u8())),
  threshold: bcs.u8(),
});

export interface Vote {
  id: string;
  creator: string;
  title: string;
  voters: string[];
  options: string[];
  /** Parallel to `voters`: whether each voter has cast their (encrypted) vote. */
  voted: boolean[];
  /** Voting deadline, ms since the Unix epoch. The vote can be finalized at/after this time. */
  endTimeMs: number;
  isFinalized: boolean;
  /** The tally per option, available once the vote is finalized. */
  result: number[] | null;
  keyServers: string[];
  threshold: number;
}

/** Parse the BCS content of a `Vote` object, as returned by `getObject`/`getObjects`. */
export function parseVote(content: Uint8Array | null | undefined): Vote | null {
  if (!content) return null;
  let raw;
  try {
    raw = VoteStruct.parse(content);
  } catch {
    return null;
  }
  return {
    id: raw.id,
    creator: raw.creator,
    title: raw.title,
    voters: raw.voters,
    options: raw.options,
    voted: raw.votes.map((v) => v !== null),
    endTimeMs: Number(raw.endTimeMs),
    isFinalized: raw.isFinalized,
    result: raw.result ? raw.result.map((n) => Number(n)) : null,
    keyServers: raw.keyServers,
    threshold: raw.threshold,
  };
}

/**
 * Unwrap the result of executing a transaction, throwing if it did not succeed on chain.
 *
 * `executeTransaction` and `signAndExecuteTransaction` return a `Transaction`/`FailedTransaction`
 * union rather than throwing, so a Move abort has to be turned into an error explicitly.
 */
export function unwrapTransaction<T extends { effects: unknown; status: ExecutionStatus }>(
  result: { $kind: 'Transaction'; Transaction: T } | { $kind: 'FailedTransaction'; FailedTransaction: T },
): T {
  const transaction = result.$kind === 'Transaction' ? result.Transaction : result.FailedTransaction;
  if (!transaction.status.success) {
    throw new Error(transaction.status.error.message);
  }
  return transaction;
}

export function explorerObjectUrl(id: string): string {
  return `https://testnet.suivision.xyz/object/${id}`;
}

export function shorten(id: string, n = 6): string {
  if (!id) return '';
  return id.length > 2 * n + 2 ? `${id.slice(0, n + 2)}…${id.slice(-n)}` : id;
}
