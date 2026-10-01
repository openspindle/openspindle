# Security

OpenSpindle drives a CNC machine, runs local conversion tools and updates itself, so a vulnerability in it can do real harm. Report one privately, not in a public issue.

## Reporting a vulnerability

Use **Report a vulnerability** on this repository's [Security tab](https://github.com/openspindle/openspindle/security/advisories/new). Say what an attacker could do, how to reproduce it and which version you tested. You get a reply there, and the fix and its advisory are prepared with you before anything is made public.

Worth reporting, for example:

- Anything that moves the machine, changes its settings or runs a program without the user's explicit action.
- A project, NC, tool library or PCB source file that runs code, or reads or writes files it should not.
- An installed app accepting an update that is not an OpenSpindle release.
- Error reports sending more than the app says they send.

Vulnerabilities in the Makera Z1's firmware belong with Makera.

## Supported versions

Fixes go into the next release, which installed apps update themselves to. Earlier releases get no fixes.
