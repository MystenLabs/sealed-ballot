// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCurrentAccount, useCurrentClient, useDAppKit } from '@mysten/dapp-kit-react';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { isValidSuiAddress } from '@mysten/sui/utils';
import { Button, Card, Flex, Heading, IconButton, Text, TextArea, TextField } from '@radix-ui/themes';
import { PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import { DEFAULT_VOTING_MINUTES, KEY_SERVER_IDS, MODULE, PACKAGE_ID, THRESHOLD } from './constants';
import { getKeyServerPublicKeys, makeSealClient } from './seal';
import { unwrapTransaction } from './utils';

// Placeholder options, shown alongside the example title.
const EXAMPLE_OPTIONS = ['Hold Me, Thrill Me, Kiss Me, Kill Me', 'Kiss from a Rose'];

export function CreateVote() {
  const navigate = useNavigate();
  const account = useCurrentAccount();
  const packageId = PACKAGE_ID;
  const suiClient = useCurrentClient();
  const dAppKit = useDAppKit();

  const [title, setTitle] = useState('');
  const [voters, setVoters] = useState(account?.address ?? '');
  const [options, setOptions] = useState(['', '']);
  const [durationMinutes, setDurationMinutes] = useState(String(DEFAULT_VOTING_MINUTES));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const minutes = Number(durationMinutes);
    if (!Number.isInteger(minutes) || minutes <= 0)
      return setError('Voting duration must be a positive whole number of minutes.');

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
          tx.pure.u64(BigInt(minutes)),
          tx.object.clock(),
        ],
      });
      tx.setGasBudget(100000000);

      const { effects } = unwrapTransaction(
        await dAppKit.signAndExecuteTransaction({ transaction: tx }),
      );
      await suiClient.waitForTransaction({ digest: effects.transactionDigest });

      // The Vote is the only shared object the transaction creates, so that identifies it without
      // having to fetch and type-check every created object.
      const created = effects.changedObjects.find(
        (c) => c.idOperation === 'Created' && c.outputOwner?.$kind === 'Shared',
      );
      setBusy(false);
      if (created) {
        setTitle('');
        setOptions(['', '']);
        navigate(`/vote/${created.objectId}`);
      }
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
            placeholder={`e.g. What's the best song on the "Batman Forever" soundtrack?`}
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
                  placeholder={EXAMPLE_OPTIONS[i] ?? `Option ${i + 1}`}
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

        <label>
          <Text as="div" size="2" mb="1" weight="bold">
            Voting duration (minutes)
          </Text>
          <Text as="div" size="1" color="gray" mb="1">
            The vote can be finalized once everyone has voted, or once this many minutes have passed
            — whichever comes first.
          </Text>
          <TextField.Root
            type="number"
            min="1"
            style={{ maxWidth: 160 }}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
          />
        </label>

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
