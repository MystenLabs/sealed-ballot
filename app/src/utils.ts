// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
import type { SuiClientTypes } from '@mysten/sui/client';
import { VOTE_TYPE } from './constants';

type ExecutionStatus = SuiClientTypes.ExecutionStatus;

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

/**
 * The Move `Vote` struct as the fullnode renders it. `u64` fields arrive as decimal strings, and a
 * Move `Option` renders as its inner value or null.
 */
interface VoteJson {
  id: string;
  creator: string;
  title: string;
  voters: string[];
  options: string[];
  votes: (unknown | null)[];
  end_time_ms: string;
  is_finalized: boolean;
  result: string[] | null;
  key_servers: string[];
  threshold: number;
}

/**
 * Parse an object fetched with `include: { json: true, type: true }` as a `Vote`.
 *
 * Returns null when the object is not a vote from this package, which is the expected outcome for
 * an id someone typed or pasted. An object of the right type whose fields are missing means the
 * Move struct has changed under this code, so that throws rather than being reported as a missing
 * vote.
 */
export function parseVote(object: { type?: string | null; json?: unknown }): Vote | null {
  if (object.type !== VOTE_TYPE) return null;

  // The type check above pins the Move struct, which is what gives this shape.
  const raw = object.json as VoteJson | null | undefined;
  if (!raw || !Array.isArray(raw.voters) || !Array.isArray(raw.votes)) {
    throw new Error(`Object has type ${VOTE_TYPE} but does not have the fields of a Vote`);
  }

  return {
    id: raw.id,
    creator: raw.creator,
    title: raw.title,
    voters: raw.voters,
    options: raw.options,
    voted: raw.votes.map((vote) => vote !== null),
    endTimeMs: Number(raw.end_time_ms),
    isFinalized: raw.is_finalized,
    result: raw.result ? raw.result.map(Number) : null,
    keyServers: raw.key_servers,
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
  result:
    | { $kind: 'Transaction'; Transaction: T }
    | { $kind: 'FailedTransaction'; FailedTransaction: T },
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

export function explorerTxUrl(digest: string): string {
  return `https://testnet.suivision.xyz/txblock/${digest}`;
}

export function shorten(id: string, n = 6): string {
  if (!id) return '';
  return id.length > 2 * n + 2 ? `${id.slice(0, n + 2)}…${id.slice(-n)}` : id;
}
