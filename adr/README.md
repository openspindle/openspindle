# Architecture Decision Records

This directory records proposed and accepted design decisions that affect OpenSpindle's architecture, machine safety, interfaces or platform support. An ADR describes an explicit decision and its trade-offs; it is not evidence that the proposed behavior has already shipped.

## Index

| ADR | Status | Topic |
| --- | --- | --- |
| [0001](0001-reliable-z1-connection-and-usb-transport.md) | Proposed | Reliable Makera Z1 connections, USB serial transport, status health, reconnection and job safety |

## Conventions

- Use `NNNN-short-descriptive-title.md`, with the next sequential number.
- Include status, date, context, decision, consequences, safety/compatibility considerations, alternatives and references.
- Write **Proposed** until a decision is approved; record any later adoption, rejection or supersession explicitly.
- If implementation changes, link the implementing PR(s) and update the ADR's status without rewriting history.
- Follow the repository's [AGENTS.md](../AGENTS.md) contribution rules: work on a branch and merge through a PR.
