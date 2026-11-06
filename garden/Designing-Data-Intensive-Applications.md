---
tags:
  - public
  - cs
  - books
created_on: 05-24-2026
related:
source: https://0-lucas.github.io/digital-garden/99.-Books/Martin-Kleppmann---Designing-Data-Intensive-Applications_-O%E2%80%99Reilly-Media-(2017).pdf
aliases:
---
Chapter 1: Reliable, Maintainable, Scalable
- Reliable
	- Fault/Failure tolerable
	- More faults, less failures, can be good.
	- Introduce faults to test fault tolerance. (Netflix chaos monkey)
	- Also robustness against bad user inputs and usage.
- Scalable
	- Able to deal with increasing load parameters on the same hardware.
	- Able to be upgraded with more processing power efficiently.
	- Consider your writes/reads ratios and other specifics for your system and make tradeoffs appropriately to create the most useful product.