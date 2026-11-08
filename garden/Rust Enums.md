---
tags:
  - public
  - cs
  - cs/languages
  - cs/languages/rust
created_on: 05-13-2026
related:
source:
aliases:
---
Attaching methods:

```rust
enum Item {
	Foo(String),
	Bar(String),
	Baz(String),
}

impl Foo {
	pub fn foo_func(&self) {
		Something
	}
}
```
