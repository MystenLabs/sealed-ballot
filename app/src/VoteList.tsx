// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
import { Link } from 'react-router-dom';
import { useSuiClientQuery } from '@mysten/dapp-kit';
import { Badge, Card, Flex, Heading, Text } from '@radix-ui/themes';
import { useNetworkVariable } from './networkConfig';
import { MODULE } from './constants';
import { parseVote, shorten } from './utils';

export function VoteList() {
  const packageId = useNetworkVariable('packageId');

  const { data: events, isPending } = useSuiClientQuery(
    'queryEvents',
    {
      query: { MoveEventType: `${packageId}::${MODULE}::VoteCreated` },
      order: 'descending',
      limit: 50,
    },
    { refetchInterval: 5000 },
  );

  const voteIds: string[] = (events?.data ?? [])
    .map((e) => (e.parsedJson as any)?.vote_id)
    .filter(Boolean);

  const { data: objects } = useSuiClientQuery(
    'multiGetObjects',
    { ids: voteIds, options: { showContent: true } },
    { enabled: voteIds.length > 0, refetchInterval: 5000 },
  );

  const votes = (objects ?? [])
    .map((o) => parseVote(o.data))
    .filter((v): v is NonNullable<typeof v> => v !== null);

  return (
    <Card>
      <Heading size="4" mb="3">
        Votes
      </Heading>
      {isPending ? (
        <Text color="gray">Loading…</Text>
      ) : votes.length === 0 ? (
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
