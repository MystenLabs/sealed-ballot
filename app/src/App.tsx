// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { Box, Card, Container, Flex, Heading, Link as RLink, Text } from '@radix-ui/themes';
import { Link, Route, Routes } from 'react-router-dom';
import { CreateVote } from './CreateVote';
import { VoteList } from './VoteList';
import { VoteView } from './VoteView';

function Home() {
  return (
    <Flex direction="column" gap="4">
      <CreateVote />
      <VoteList />
    </Flex>
  );
}

function App() {
  const account = useCurrentAccount();
  return (
    <Container size="3" px="4" py="5">
      <Flex justify="between" align="center" mb="4">
        <Link to="/" style={{ textDecoration: 'none' }}>
          <Heading size="7" style={{ color: 'var(--accent-11)' }}>
            🗳️ Seal Voting
          </Heading>
        </Link>
        <ConnectButton />
      </Flex>

      <Card mb="4">
        <Text as="p" size="2" color="gray">
          Private, threshold-encrypted voting on Sui Testnet, powered by{' '}
          <RLink href="https://github.com/MystenLabs/seal" target="_blank">
            Seal
          </RLink>
          . Anyone can create a vote with a whitelist of voters and a set of options. Voters submit
          encrypted votes that stay secret while the vote is open; once everyone has voted, anyone
          can finalize to decrypt and tally on-chain. It's a sealed ballot — finalizing reveals the
          individual votes, not just the totals. Set your wallet to <b>Testnet</b> and fund it from
          the{' '}
          <RLink href="https://faucet.sui.io/" target="_blank">
            faucet
          </RLink>
          .
        </Text>
      </Card>

      {account ? (
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/vote/:id" element={<VoteView />} />
        </Routes>
      ) : (
        <Box>
          <Text color="gray">Please connect your wallet to continue.</Text>
        </Box>
      )}
    </Container>
  );
}

export default App;
