// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { isValidSuiAddress } from '@mysten/sui/utils';
import { Button, Card, Flex, Heading, IconButton, Text, TextArea, TextField } from '@radix-ui/themes';
import { PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import { useNetworkVariable } from './networkConfig';
import { KEY_SERVER_IDS, MODULE, THRESHOLD } from './constants';
import { getKeyServerPublicKeys, makeSealClient } from './seal';

export function CreateVote() {
  const navigate = useNavigate();
  const account = useCurrentAccount();
  const packageId = useNetworkVariable('packageId');
  const suiClient = useSuiClient();

  const [title, setTitle] = useState('');
  const [voters, setVoters] = useState(account?.address ?? '');
  const [options, setOptions] = useState(['', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { mutate: signAndExecute } = useSignAndExecuteTransaction({
    execute: async ({ bytes, signature }) =>
      await suiClient.executeTransactionBlock({
        transactionBlock: bytes,
        signature,
        options: { showEffects: true, showObjectChanges: true },
      }),
  });

  const setOption = (i: number, v: string) =>
    setOptions((prev) => prev.map((o, idx) => (idx === i ? v : o)));
  const addOption = () => setOptions((prev) => [...prev, '']);
  const removeOption = (i: number) =>
    setOptions((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev));

  async function handleCreate() {
    setError(null);
    const cleanTitle = title.trim();
    const voterList = voters
      .split(/[\s,]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    const optionList = options.map((o) => o.trim()).filter(Boolean);

    if (!cleanTitle) return setError('Please enter a title.');
    if (voterList.length === 0) return setError('Add at least one voter address.');
    const bad = voterList.find((v) => !isValidSuiAddress(v));
    if (bad) return setError(`Invalid Sui address: ${bad}`);
    if (new Set(voterList).size !== voterList.length)
      return setError('Duplicate voter addresses are not allowed.');
    if (optionList.length < 2) return setError('Add at least two options.');

    setBusy(true);
    try {
      const sealClient = makeSealClient(suiClient);
      const publicKeys = await getKeyServerPublicKeys(sealClient);

      const tx = new Transaction();
      tx.moveCall({
        target: `${packageId}::${MODULE}::create_vote`,
        arguments: [
          tx.pure.address(packageId),
          tx.pure.string(cleanTitle),
          tx.pure.vector('address', voterList),
          tx.pure.vector('string', optionList),
          tx.pure.vector('address', KEY_SERVER_IDS),
          tx.pure(
            bcs
              .vector(bcs.vector(bcs.u8()))
              .serialize(publicKeys.map((pk) => Array.from(pk)))
              .toBytes(),
          ),
          tx.pure.u8(THRESHOLD),
        ],
      });
      tx.setGasBudget(100000000);

      signAndExecute(
        { transaction: tx },
        {
          onSuccess: (result) => {
            setBusy(false);
            const created = result.objectChanges?.find(
              (c: any) => c.type === 'created' && c.objectType?.endsWith('::voting::Vote'),
            ) as any;
            if (created?.objectId) {
              setTitle('');
              setOptions(['', '']);
              navigate(`/vote/${created.objectId}`);
            }
          },
          onError: (e) => {
            setBusy(false);
            setError(String(e));
          },
        },
      );
    } catch (e) {
      setBusy(false);
      setError(String(e));
    }
  }

  return (
    <Card>
      <Heading size="4" mb="3">
        Create a vote
      </Heading>
      <Flex direction="column" gap="3">
        <label>
          <Text as="div" size="2" mb="1" weight="bold">
            Title
          </Text>
          <TextField.Root
            placeholder="e.g. Where should the next offsite be?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label>
          <Text as="div" size="2" mb="1" weight="bold">
            Eligible voters
          </Text>
          <Text as="div" size="1" color="gray" mb="1">
            One Sui address per line (or separated by spaces/commas). Only these addresses can vote.
          </Text>
          <TextArea
            rows={4}
            placeholder="0x..."
            value={voters}
            onChange={(e) => setVoters(e.target.value)}
          />
        </label>

        <div>
          <Text as="div" size="2" mb="1" weight="bold">
            Options
          </Text>
          <Flex direction="column" gap="2">
            {options.map((opt, i) => (
              <Flex key={i} gap="2" align="center">
                <TextField.Root
                  style={{ flex: 1 }}
                  placeholder={`Option ${i + 1}`}
                  value={opt}
                  onChange={(e) => setOption(i, e.target.value)}
                />
                <IconButton
                  variant="soft"
                  color="red"
                  disabled={options.length <= 2}
                  onClick={() => removeOption(i)}
                >
                  <TrashIcon />
                </IconButton>
              </Flex>
            ))}
            <Button variant="soft" onClick={addOption} style={{ alignSelf: 'flex-start' }}>
              <PlusIcon /> Add option
            </Button>
          </Flex>
        </div>

        {error && (
          <Text color="red" size="2">
            {error}
          </Text>
        )}

        <Button size="3" onClick={handleCreate} disabled={busy}>
          {busy ? 'Creating…' : 'Create vote'}
        </Button>
      </Flex>
    </Card>
  );
}
