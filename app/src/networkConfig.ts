// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
import { getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { createNetworkConfig } from '@mysten/dapp-kit';
import { PACKAGE_ID } from './constants';

const { networkConfig, useNetworkVariable, useNetworkVariables } = createNetworkConfig({
  testnet: {
    url: getJsonRpcFullnodeUrl('testnet'),
    network: 'testnet',
    variables: {
      packageId: PACKAGE_ID,
    },
  },
});

export { useNetworkVariable, useNetworkVariables, networkConfig };
