// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useCurrentClient } from '@mysten/dapp-kit-react';
import { Badge, Card, Flex, Heading, Text } from '@radix-ui/themes';
import { GRAPHQL_URL, MODULE, PACKAGE_ID } from './constants';
import { parseVote, shorten } from './utils';

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

/**
 * Look up the ids of recently created votes from the `VoteCreated` events.
 *
 * The gRPC API has no event query, so this goes through GraphQL. Note that the public GraphQL
 * indexer only retains roughly the last month of events, so votes older than that stop appearing
 * in this list even though the objects themselves are still readable by id.
 */
async function fetchRecentVoteIds(): Promise<string[]> {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: RECENT_VOTES_QUERY,
      variables: { type: `${PACKAGE_ID}::${MODULE}::VoteCreated` },
    }),
  });
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors[0].message);
  const nodes: any[] = body.data?.events?.nodes ?? [];
  // Newest first.
  return nodes
    .map((node) => node.contents?.json?.vote_id)
    .filter((id): id is string => Boolean(id))
    .reverse();
}

export function VoteList() {
  const suiClient = useCurrentClient();

  const { data: voteIds, isPending } = useQuery({
    queryKey: ['voteIds', PACKAGE_ID],
    queryFn: fetchRecentVoteIds,
    refetchInterval: 5000,
  });

  const { data: votes } = useQuery({
    queryKey: ['votes', voteIds],
    enabled: !!voteIds?.length,
    refetchInterval: 5000,
    queryFn: async () => {
      const { objects } = await suiClient.getObjects({
        objectIds: voteIds!,
        include: { content: true },
      });
      return objects
        .map((object) => (object instanceof Error ? null : parseVote(object.content)))
        .filter((vote): vote is NonNullable<typeof vote> => vote !== null);
    },
  });

  return (
    <Card>
      <Heading size="4" mb="3">
        Votes
      </Heading>
      {isPending ? (
        <Text color="gray">Loading…</Text>
      ) : !votes?.length ? (
        <Text color="gray">No votes yet. Create the first one above.</Text>
      ) : (
        <Flex direction="column" gap="2">
          {votes.map((v) => {
            const castCount = v.voted.filter(Boolean).length;
            const canFinalize =
              !v.isFinalized && (castCount === v.voters.length || Date.now() >= v.endTimeMs);
            return (
              <Link
                key={v.id}
                to={`/vote/${v.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <Card variant="surface">
                  <Flex justify="between" align="center">
                    <Flex direction="column" gap="1">
                      <Text weight="bold">{v.title || '(untitled)'}</Text>
                      <Text size="1" color="gray">
                        {shorten(v.id)} · {v.options.length} options · {castCount}/{v.voters.length}{' '}
                        voted
                      </Text>
                    </Flex>
                    {v.isFinalized ? (
                      <Badge color="green">Finalized</Badge>
                    ) : canFinalize ? (
                      <Badge color="amber">Ready to finalize</Badge>
                    ) : (
                      <Badge color="blue">Open</Badge>
                    )}
                  </Flex>
                </Card>
              </Link>
            );
          })}
        </Flex>
      )}
    </Card>
  );
}
