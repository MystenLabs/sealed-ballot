// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { FULLNODE_URL } from './constants';

/**
 * The dApp kit instance for the demo. It talks to the fullnode over gRPC: the JSON-RPC API that
 * older versions of the Sui SDK used has been retired on the public fullnodes.
 */
export const dAppKit = createDAppKit({
  networks: ['testnet'],
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: FULLNODE_URL }),
});

export type AppSuiClient = ReturnType<typeof dAppKit.getClient>;

declare module '@mysten/dapp-kit-react' {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
