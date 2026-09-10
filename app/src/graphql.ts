// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
import { GRAPHQL_URL, MODULE, PACKAGE_ID } from './constants';

/**
 * Run a GraphQL query against the Sui indexer.
 *
 * The gRPC API the rest of the app uses covers objects and transaction execution but has no event
 * or transaction-history query, so those two lookups go through GraphQL instead. Note the public
 * indexer only retains roughly the last month, so anything older is simply not returned.
 */
async function graphqlRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  return body.data as T;
}

const RECENT_VOTES_QUERY = `
  query RecentVotes($type: String!) {
    events(last: 50, filter: { type: $type }) {
      nodes {
        contents {
          json
        }
      }
    }
  }
`;

/** The ids of recently created votes, newest first, from the `VoteCreated` events. */
export async function fetchRecentVoteIds(): Promise<string[]> {
  const data = await graphqlRequest<any>(RECENT_VOTES_QUERY, {
    type: `${PACKAGE_ID}::${MODULE}::VoteCreated`,
  });
  return (data?.events?.nodes ?? [])
    .map((node: any) => node.contents?.json?.vote_id)
    .filter((id: unknown): id is string => Boolean(id))
    .reverse();
}

const VOTE_TRANSACTIONS_QUERY = `
  query VoteTransactions($vote: SuiAddress!) {
    transactions(first: 50, filter: { affectedObject: $vote }) {
      nodes {
        digest
        sender {
          address
        }
        effects {
          status
          timestamp
        }
        kind {
          ... on ProgrammableTransaction {
            commands {
              nodes {
                ... on MoveCallCommand {
                  function {
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** One transaction that touched a Vote object. */
export interface VoteTransaction {
  digest: string;
  sender: string | null;
  /** The `voting` function this transaction called: create_vote, cast_vote or finalize_vote. */
  function: string | null;
  timestampMs: number | null;
  succeeded: boolean;
}

/** Every transaction that touched a vote, oldest first. */
export async function fetchVoteTransactions(voteId: string): Promise<VoteTransaction[]> {
  const data = await graphqlRequest<any>(VOTE_TRANSACTIONS_QUERY, { vote: voteId });
  return (data?.transactions?.nodes ?? []).map((node: any) => {
    const call = (node.kind?.commands?.nodes ?? []).find((c: any) => c.function?.name);
    const timestamp = node.effects?.timestamp;
    return {
      digest: node.digest,
      sender: node.sender?.address ?? null,
      function: call?.function?.name ?? null,
      timestampMs: timestamp ? Date.parse(timestamp) : null,
      succeeded: node.effects?.status === 'SUCCESS',
    };
  });
}
