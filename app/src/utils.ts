// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
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
  publicKeys: number[][];
  threshold: number;
}

// Sui renders `Option<T>` in object content either as `T | null`, or (depending on version) as a
// struct `{ fields: { vec: [...] } }`. Normalize both into the inner value or null.
function unwrapOption(value: any): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const vec = value.fields?.vec ?? value.vec;
    if (Array.isArray(vec)) return vec.length > 0 ? vec[0] : null;
  }
  return value;
}

// `data` is the object returned by getObject/multiGetObjects (with showContent: true).
export function parseVote(data: any): Vote | null {
  if (!data) return null;
  const fields = data.content?.fields;
  if (!fields) return null;

  const votesRaw: any[] = fields.votes ?? [];
  const resultInner = unwrapOption(fields.result);

  return {
    id: data.objectId,
    creator: fields.creator,
    title: fields.title,
    voters: fields.voters ?? [],
    options: fields.options ?? [],
    voted: votesRaw.map((v) => unwrapOption(v) !== null),
    endTimeMs: Number(fields.end_time_ms ?? 0),
    isFinalized: Boolean(fields.is_finalized),
    result: resultInner ? (resultInner as any[]).map((n) => Number(n)) : null,
    keyServers: fields.key_servers ?? [],
    publicKeys: (fields.public_keys ?? []).map((pk: any[]) => pk.map((b) => Number(b))),
    threshold: Number(fields.threshold),
  };
}

export function explorerObjectUrl(id: string): string {
  return `https://testnet.suivision.xyz/object/${id}`;
}

export function shorten(id: string, n = 6): string {
  if (!id) return '';
  return id.length > 2 * n + 2 ? `${id.slice(0, n + 2)}…${id.slice(-n)}` : id;
}
