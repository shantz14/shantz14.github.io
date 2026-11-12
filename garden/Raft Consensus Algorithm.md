---
tags:
  - public
  - cs/distributed-systems
  - cs/algorithms
created_on: 11-09-2026
related:
source: "[[@ongaroSearchUnderstandableConsensus2014|(Ongaro & Ousterhout, 2014)]]"
aliases:
  - Raft
---
An algorithm for guaranteeing eventual consistency in replicated distributed storage systems.
## Purpose
Distribute your data store across 5/7/11... clusters and guarantee consistency between them.  Functional as long as a majority of the nodes are healthy. 

## Strong Leader
The "leader" node always handles client requests.  Client requests that reach a follower are forwarded to the leader.  The leader then sends AppendEntries RPCs(Remote Procedure Calls) to it's followers **in parallel** to replicate the information across the cluster.  It does not respond to the client with success until it knows the change has been safely replicated, and it will keep sending AppendEntries RPCs indefinitely until all nodes have successfully received the change.

A change is considered "committed" when the majority of the servers have replicated the log entry.  A committed change is safe for a server to apply to it's state machine(kv store, database, etc).  Only a leader can decide when a change is committed and it can only commit entries from it's own term.  Uncommitted entries it has from previous terms are indirectly committed when an entry in front of it from the current term is committed.

## **Leader Election**
Servers will start an election when they timeout waiting for a request from a leader.  They move to the candidate state, increment their term, and start sending vote requests to the rest of the cluster.  A randomized timer starts (e.g., 150-300 ms) and if a majority is not reached in that time a timeout occurs and the server increments their term again and starts a new election.  The randomized timeouts help with availability somehow.

At any point if the server receives an AppendEntries RPC from a leader with a term >= the servers own term, it immediately reverts to the follower state and applies the change to it's log.  Requests from leaders with a lower term then the server's own term are ignored.
### How to Get Elected
A candidate can be elected leader if it contacts a majority of the cluster with RequestVote RPCs and is **at least** as up to date as every other node it contacts.  This guarantees that it has every **committed** entry.
## **Membership Changes**

## AppendEntries
These requests are only send from leaders.  The request should include some metadata:
- The index and term of the entries right before the new entries.  The receiving server checks if it has entries with matching term/index to see if it is up to date enough to accept these new entries.  If it does not have matching entries, it refuses the new entries.
When an AppendEntries request is denied, the leader decrements it's nextIndex count, and sends requests with log entries on that index instead.  This will continue until it reaches an index where the leader and follower logs match, then the requests will start succeeding and the logs are consistent again.  This means that the leader can overwrite the logs of followers.

Possible scenario:
 ![[Pasted image 20261112130731.png]]
 An important thing to understand is that the entries that the followers have and the leader doesn't are **uncommitted**.  A server cannot be elected leader if it lacks a **committed** entry.  Committed logs cannot be overwritten only uncommitted logs can, meaning they are just in the log not in the actual store/state machine.
 The result here without a leader crash is that the leader overwrites any entries it does not have and they are lost without being committed, so the client times out and will retry it's request.

Server states:
![[Pasted Image 20261111143737_349.png]]

# Development
Raft was created with the goal of **understandability** in mind.  Decisions about the algorithm were often made with the main criteria being 'what will be easier to explain and understand.'

# Misc
Produces the same result as [[Paxos]], but is easier to understand. 