// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

/// Private voting with Seal (on-chain decryption).
///
/// - Anyone can create a vote with a title, a set of named options, and a whitelist of eligible voters.
/// - Each whitelisted voter submits a single encrypted vote (the index of the option they choose),
///   threshold-encrypted with Seal. The voter's address is used as the `aad` so an encrypted vote
///   cannot be copied and cast by someone else.
/// - Once every whitelisted voter has voted, anyone can finalize the vote: the Seal derived keys are
///   fetched from the key servers and submitted, and the votes are decrypted and tallied on-chain.
/// - Invalid votes (wrong option, malformed ciphertext, ...) are ignored in the tally.
///
/// This is an example of Seal on-chain decryption. It is adapted from the `voting` pattern in the Seal
/// repository (move/patterns/sources/voting.move) with a few changes for use as a deployed demo app:
///   - options carry human-readable labels (`vector<String>`),
///   - the Seal package-id namespace is stored on the `Vote` (set by the creator to the deployed
///     package id) rather than the `@0x0` used by the test pattern,
///   - `Vote` is a shared object and create/cast/finalize are callable from PTBs,
///   - the tally is stored on the `Vote` and events are emitted for discovery.
///
/// NOTE: the `package_id` supplied at creation must be the package id that Seal uses for key
/// derivation, i.e. the original (first) id of this package. This assumes the package is not upgraded
/// after the votes are created (on first publish published-at == original-id).
module seal_voting::voting;

use seal::bf_hmac_encryption::{
    EncryptedObject,
    VerifiedDerivedKey,
    PublicKey,
    decrypt,
    new_public_key,
    verify_derived_keys,
    parse_encrypted_object
};
use std::string::String;
use sui::bls12381::g1_from_bytes;
use sui::event;

const EInvalidVote: u64 = 1;
const EVoteNotDone: u64 = 2;
const EAlreadyFinalized: u64 = 3;
const ENotEnoughKeys: u64 = 4;
const ENotAVoter: u64 = 5;
const EInvalidOptions: u64 = 6;

/// This represents a vote.
public struct Vote has key {
    /// The id of a vote is the id of the object.
    id: UID,
    /// The address that created the vote.
    creator: address,
    /// The Seal package-id namespace the votes are encrypted under (the deployed package id).
    package_id: address,
    /// A human-readable title for the vote.
    title: String,
    /// The eligible voters of the vote.
    voters: vector<address>,
    /// The options the voters can vote for, as human-readable labels.
    options: vector<String>,
    /// This holds the encrypted votes assuming the same order as the `voters` vector.
    votes: vector<Option<EncryptedObject>>,
    /// Whether the vote has been finalized yet.
    is_finalized: bool,
    /// The tally, set when the vote is finalized. `result[i]` is the number of votes for option `i`.
    result: Option<vector<u64>>,
    /// The key servers that must be used for the encryption of the votes.
    key_servers: vector<address>,
    /// The public keys for the key servers in the same order as `key_servers`.
    public_keys: vector<vector<u8>>,
    /// The threshold for the vote.
    threshold: u8,
}

/// Emitted when a vote is created, so frontends can discover votes.
public struct VoteCreated has copy, drop {
    vote_id: address,
    creator: address,
}

/// Emitted when a vote is finalized.
public struct VoteFinalized has copy, drop {
    vote_id: address,
    result: vector<u64>,
}

// The id of a vote is the id of the object.
public fun id(v: &Vote): vector<u8> {
    object::id(v).to_bytes()
}

/// The winning option of a tally. Returns the lowest index in case of a tie.
public fun winner(result: &vector<u64>): u8 {
    let (mut max_votes, mut option) = (0u64, 0u8);
    result.length().do!(|i| {
        let votes = result[i];
        if (votes > max_votes) {
            max_votes = votes;
            option = i as u8;
        };
    });
    option
}

#[test_only]
public fun destroy_for_testing(v: Vote) {
    let Vote { id, .. } = v;
    object::delete(id);
}

/// Create a vote and share it so that the whitelisted voters can cast their votes.
/// The associated Seal key-ids are [pkg id][vote id].
public fun create_vote(
    package_id: address,
    title: String,
    voters: vector<address>,
    options: vector<String>,
    key_servers: vector<address>,
    public_keys: vector<vector<u8>>,
    threshold: u8,
    ctx: &mut TxContext,
) {
    assert!(threshold <= key_servers.length() as u8);
    assert!(key_servers.length() == public_keys.length());
    assert!(options.length() >= 2, EInvalidOptions);
    let vote = Vote {
        id: object::new(ctx),
        creator: ctx.sender(),
        package_id,
        title,
        voters,
        key_servers,
        public_keys,
        threshold,
        is_finalized: false,
        result: option::none(),
        votes: vector::tabulate!(voters.length(), |_| option::none()),
        options,
    };
    event::emit(VoteCreated { vote_id: vote.id.to_address(), creator: ctx.sender() });
    transfer::share_object(vote);
}

/// Cast a vote.
/// The encrypted object should be an encryption of a single u8 (the option index) and have the sender's
/// address as aad.
public fun cast_vote(vote: &mut Vote, encrypted_vote: vector<u8>, ctx: &mut TxContext) {
    let encrypted_vote = parse_encrypted_object(encrypted_vote);

    // The voter id must be put as aad to ensure that an encrypted vote cannot be copied and cast by
    // another voter.
    assert!(encrypted_vote.aad().borrow() == ctx.sender().to_bytes(), EInvalidVote);

    // All encrypted votes must have been encrypted using the same key servers and the same threshold.
    // We could allow the order of the key servers to be different, but for the sake of simplicity, we
    // also require the same order.
    assert!(encrypted_vote.services() == vote.key_servers, EInvalidVote);
    assert!(encrypted_vote.threshold() == vote.threshold, EInvalidVote);

    // Check that the encryptions were created for this vote and this package.
    assert!(encrypted_vote.id() == vote.id(), EInvalidVote);
    assert!(encrypted_vote.package_id() == vote.package_id, EInvalidVote);

    // This aborts if the sender is not a voter.
    assert!(vote.voters.contains(&ctx.sender()), ENotAVoter);
    let index = vote.voters.find_index!(|voter| voter == ctx.sender()).destroy_some();
    vote.votes[index].fill(encrypted_vote);
}

entry fun seal_approve(id: vector<u8>, vote: &Vote) {
    assert!(id == vote.id(), EInvalidVote);
    assert!(vote.votes.all!(|vote| vote.is_some()), EVoteNotDone);
}

/// Finalize a vote.
/// Updates the `result` field of the vote to hold the tally for each option.
/// Aborts if the vote has already been finalized.
/// Aborts if there are not enough keys or if they are not valid, e.g. if they were derived for a
/// different purpose. In case the keys are valid but a vote is invalid, decrypt just ignores that vote.
///
/// The given derived keys and key servers should be in the same order.
public fun finalize_vote(
    vote: &mut Vote,
    derived_keys: vector<vector<u8>>,
    key_servers: vector<address>,
) {
    assert!(!vote.is_finalized, EAlreadyFinalized);
    assert!(key_servers.length() == derived_keys.length());
    assert!(derived_keys.length() as u8 >= vote.threshold, ENotEnoughKeys);

    // Verify the derived keys against the public keys of the given key servers.
    let verified_derived_keys: vector<VerifiedDerivedKey> = verify_derived_keys(
        &derived_keys.map_ref!(|k| g1_from_bytes(k)),
        vote.package_id,
        vote.id(),
        &key_servers
            .map_ref!(|ks1| vote.key_servers.find_index!(|ks2| ks1 == ks2).destroy_some())
            .map!(|i| new_public_key(vote.key_servers[i].to_id(), vote.public_keys[i])),
    );

    // Public keys for all key servers
    let all_public_keys: vector<PublicKey> = vote
        .key_servers
        .zip_map!(vote.public_keys, |ks, pk| new_public_key(ks.to_id(), pk));

    // This aborts if there are not enough keys or if they are invalid, e.g. if they were derived for a
    // different purpose. However, in case the keys are valid but some of the encrypted objects, aka the
    // votes, are invalid, decrypt will just return none for these votes.
    let number_of_options = vote.options.length();
    let mut result = vector::tabulate!(number_of_options, |_| 0);
    vote
        .votes
        .do_ref!(
            |v| v
                .and_ref!(|v| decrypt(v, &verified_derived_keys, &all_public_keys))
                .do_ref!(|decrypted| {
                    if (decrypted.length() == 1 && (decrypted[0] as u64) < number_of_options) {
                        let option = decrypted[0] as u64;
                        *&mut result[option] = result[option] + 1;
                    };
                }),
        );

    vote.is_finalized = true;
    vote.result = option::some(result);
    event::emit(VoteFinalized { vote_id: vote.id.to_address(), result });
}
