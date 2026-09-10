// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

/// Sealed-ballot voting with Seal, decrypted and tallied on-chain.
///
/// Whitelisted voters each cast one Seal-encrypted option index. Once everyone has voted, or the
/// deadline has passed, anyone can submit the derived keys to finalize, and the votes are decrypted
/// and tallied on-chain. Invalid votes are ignored. Votes are secret only until that reveal, which
/// publishes the individual votes and not just the tally.
///
/// `package_id` must be the original (first) id of this package, since that is what Seal derives
/// keys from, so the package must not be upgraded between creating and finalizing a vote.
///
/// Adapted from the `voting` pattern in the Seal repository.
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
use sui::clock::Clock;
use sui::event;

const MS_PER_MINUTE: u64 = 60_000;

const EInvalidVote: u64 = 1;
const EVoteNotDone: u64 = 2;
const EAlreadyFinalized: u64 = 3;
const ENotEnoughKeys: u64 = 4;
const ENotAVoter: u64 = 5;
const EInvalidOptions: u64 = 6;

public struct Vote has key {
    id: UID,
    creator: address,
    package_id: address,
    title: String,
    voters: vector<address>,
    options: vector<String>,
    /// The encrypted votes, in the same order as `voters`.
    votes: vector<Option<EncryptedObject>>,
    end_time_ms: u64,
    is_finalized: bool,
    /// `result[i]` is the number of votes for option `i`, set when the vote is finalized.
    result: Option<vector<u64>>,
    key_servers: vector<address>,
    /// The public keys of `key_servers`, in the same order.
    public_keys: vector<vector<u8>>,
    threshold: u8,
}

public struct VoteCreated has copy, drop {
    vote_id: address,
    creator: address,
}

public struct VoteFinalized has copy, drop {
    vote_id: address,
    result: vector<u64>,
}

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

/// Create a vote and share it so that the whitelisted voters can cast their votes.
public fun create_vote(
    package_id: address,
    title: String,
    voters: vector<address>,
    options: vector<String>,
    key_servers: vector<address>,
    public_keys: vector<vector<u8>>,
    threshold: u8,
    voting_minutes: u64,
    clock: &Clock,
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
        end_time_ms: clock.timestamp_ms() + voting_minutes * MS_PER_MINUTE,
        is_finalized: false,
        result: option::none(),
        votes: vector::tabulate!(voters.length(), |_| option::none()),
        options,
    };
    event::emit(VoteCreated { vote_id: vote.id.to_address(), creator: ctx.sender() });
    transfer::share_object(vote);
}

/// Cast a vote. `encrypted_vote` must encrypt a single u8, the option index, with the sender's
/// address as aad so that it cannot be copied and cast by another voter.
public fun cast_vote(vote: &mut Vote, encrypted_vote: vector<u8>, ctx: &mut TxContext) {
    let encrypted_vote = parse_encrypted_object(encrypted_vote);

    assert!(encrypted_vote.aad().borrow() == ctx.sender().to_bytes(), EInvalidVote);
    assert!(encrypted_vote.services() == vote.key_servers, EInvalidVote);
    assert!(encrypted_vote.threshold() == vote.threshold, EInvalidVote);
    assert!(encrypted_vote.id() == vote.id(), EInvalidVote);
    assert!(encrypted_vote.package_id() == vote.package_id, EInvalidVote);

    assert!(vote.voters.contains(&ctx.sender()), ENotAVoter);
    let index = vote.voters.find_index!(|voter| voter == ctx.sender()).destroy_some();
    vote.votes[index].fill(encrypted_vote);
}

/// Authorizes the key servers to release the decryption keys.
entry fun seal_approve(id: vector<u8>, vote: &Vote, clock: &Clock) {
    assert!(id == vote.id(), EInvalidVote);
    let all_voted = vote.votes.all!(|vote| vote.is_some());
    let deadline_passed = clock.timestamp_ms() >= vote.end_time_ms;
    assert!(all_voted || deadline_passed, EVoteNotDone);
}

/// Decrypt the votes and store the tally. `derived_keys` and `key_servers` must be in the same
/// order. Aborts if the keys are missing or invalid; individual votes that fail to decrypt, or that
/// name an option out of range, are left out of the tally.
public fun finalize_vote(
    vote: &mut Vote,
    derived_keys: vector<vector<u8>>,
    key_servers: vector<address>,
) {
    assert!(!vote.is_finalized, EAlreadyFinalized);
    assert!(key_servers.length() == derived_keys.length());
    assert!(derived_keys.length() as u8 >= vote.threshold, ENotEnoughKeys);

    let verified_derived_keys: vector<VerifiedDerivedKey> = verify_derived_keys(
        &derived_keys.map_ref!(|k| g1_from_bytes(k)),
        vote.package_id,
        vote.id(),
        &key_servers
            .map_ref!(|ks1| vote.key_servers.find_index!(|ks2| ks1 == ks2).destroy_some())
            .map!(|i| new_public_key(vote.key_servers[i].to_id(), vote.public_keys[i])),
    );

    let all_public_keys: vector<PublicKey> = vote
        .key_servers
        .zip_map!(vote.public_keys, |ks, pk| new_public_key(ks.to_id(), pk));

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
