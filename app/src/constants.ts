// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

// The seal_voting Move package, published on Sui Testnet.
export const PACKAGE_ID = '0x08fede920add951edfae4d27b8859a233bf5d640aee0f19ae279d8ce5ee62edc';

// The Seal key servers used for encryption and on-chain decryption.
// These are the Mysten Labs "Open" mode independent testnet key servers
// (see https://seal-docs.wal.app/Pricing#verified-key-servers).
// The order here is significant: votes are encrypted against these servers in this exact order,
// and the on-chain `cast_vote` requires the encrypted object's services to match the vote's
// `key_servers` field (which is set to this list when a vote is created).
export const KEY_SERVER_IDS = [
  '0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75', // mysten-testnet-1
  '0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8', // mysten-testnet-2
];

// Threshold for the threshold encryption: how many key servers must contribute a derived key to
// decrypt a vote. With two servers and a threshold of two, both servers must participate.
export const THRESHOLD = 2;

export const MODULE = 'voting';
