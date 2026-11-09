---
tags:
  - public
  - cs
  - cs/containerization
created_on: 04-14-2026
related:
source:
aliases:
---
Docker uses a Linux kernel feature called [[Linux Namespaces]], to create the "container" environment a container process lives in.  A namespace limits what the process can see to create the effect of an isolated environment.  In a namespace, an unprivileged process can have root access within the namespace, allowing for full manipulation of the system within the namespace. Docker uses all sorts of namespaces including network, mount, pid, and more namespaces to emulate the full capabilities of a regular machine in an isolated environment.  It's pretty cool, its a process running on a machine that thinks it is the only thing running on that machine when in reality it is sharing network, filesystem, process-tree, and more with the parent machine.

[[Cgroup]]s isolate and limit system resources for a container, so you can assign 2 cores, 1 gig of memory, etc.

So the docker client(CLI) interacts with the Docker Daemon which interacts with containerd (industry standard container daemon) and runc(runs commands inside containers) to do the thing.
# Useful Links
https://roadmap.sh/docker 
https://docs.docker.com/get-started/docker-overview/

# Commands
Run/Exec/Entrypoint
**RUN** is used to run commands like apt install.  Creates a new image layer, so combine RUN commands as much as you can to reduce image size.
**EXEC** defines the default command and args that runs when you run the image with docker run.  Use when you want the same args supplied every time.
**ENTRYPOINT** is like exec but use it when you want the user to supply args to be appended to the command.  You can acheive this with overriding flags with EXEC but standard practice is to use ENTRYPOINT.
ENTRYPOINT and EXEC can be used together to allow for user args and also provide default args.