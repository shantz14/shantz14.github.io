---
tags:
  - public
  - cs
  - cs/specification
  - cs/languages
created_on: 04-14-2026
related: "[[TLA+ for testing]]"
source:
aliases:
---
https://jack-vanlightly.com/blog/2023/10/10/a-primer-on-formal-verification-and-tla
https://conf.tlapl.us/2020/04-Ron_Pressler-TLA+_Truffle_Composition_Capers-Slides.pdf

TLA+ is a formal verification language that uses temporal logic(<>, []) and first-order logic(/\, \/, =>) to define a state space and Safety/Liveliness **fairness** properties that allows you to verify properties of a system.  An **action** is a definition of a state -> next-state relation.  TLC, the TLA+ model checker uses these actions to build and explore a state space graph using a brute force depth-first search.  If an invariant, something like `NoNegativesInvariant == \A n \in numbers : n > -1` (this is a ) is violated, i.e. TLC finds a state where numbers = {2, -3, 1}, then TLC will stop and report this violation.  Define you system, and define rules you expect it to follow, and TLC can find ways your system breaks your rules.

I want to look into where this language is really used in the real world.

https://foundation.tlapl.us/industry/index.html
https://blogs.oracle.com/cloud-infrastructure/sleeping-soundly-with-the-help-of-tla

https://www.hillelwayne.com/post/list-of-tla-examples/

[[TLA+ for testing]] is a use case of TLA+ that is not standard and introducing real time interactions with external systems must introduce changes in behavior from a regular TLA+ spec right?
I would like to find real world examples of people trying this as well.