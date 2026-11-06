---
tags:
  - public
  - cs
  - cs/linux
  - cs/containerization
created_on: 04-20-2026
related:
source:
aliases:
---
 A linux feature used to limit what a process can see on the system.
https://lwn.net/Articles/531114/

It seems like the creation of the User Namespace is what enabled the containerization we have today.
The User namespace allows for an unprivileged user/process to have root privileges within the namespace.  Of course this new privileged user/process is limited to the scope of the namespace.

OK no so the user namespace used as well as all the other namespaces (network, mount, etc) make a container you kinda need all of them.