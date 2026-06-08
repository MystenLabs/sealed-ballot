// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
import { SealClient } from '@mysten/seal';
import type { SealCompatibleClient } from '@mysten/seal';
import { KEY_SERVER_IDS } from './constants';

/**
 * Create a SealClient configured to use the demo's key servers (weight 1 each).
 * `verifyKeyServers` is false because we use a fixed, known set of Mysten Open testnet servers.
 */
export function makeSealClient(suiClient: SealCompatibleClient): SealClient {
  return new SealClient({
    suiClient,
    serverConfigs: KEY_SERVER_IDS.map((objectId) => ({ objectId, weight: 1 })),
    verifyKeyServers: false,
  });
}

/**
 * Fetch the public keys of the configured key servers, returned in the same order as KEY_SERVER_IDS.
 * These are stored on the Vote object at creation time so that the votes can be decrypted on-chain.
 */
export async function getKeyServerPublicKeys(client: SealClient): Promise<Uint8Array[]> {
  const servers = await client.getKeyServers();
  return KEY_SERVER_IDS.map((id) => {
    const server = servers.get(id);
    if (!server) {
      throw new Error(`Key server ${id} not found on chain`);
    }
    return server.pk;
  });
}
