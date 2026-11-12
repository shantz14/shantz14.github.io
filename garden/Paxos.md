---
tags:
  - public
  - cs/distributed-systems
  - cs/algorithms
created_on: <% tp.date.now("MM-DD-YYYY") %>
related:
source: "[[@lamport1998parttime|(Lamport, 1998)]]"
aliases:
---
A consensus algorithm very popular in the past especially before [[Raft Consensus Algorithm|Raft]].  Created by [[People#Leslie Lamport]].
https://www.geeksforgeeks.org/computer-networks/paxos-consensus-algorithm/

Difficult to understand and difficult to implement in a real system.  Often people would end up implementing their own Paxos-like algorithm because the real thing is too impractical. [[@ongaroSearchUnderstandableConsensus2014|(Ongaro & Ousterhout, 2014)]]