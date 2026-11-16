# 0002 — Worker-owned timer engine and bounded virtual monitor

- Status: Accepted
- Date: 2026-11-16

## Context

Chronos needs to demonstrate management of 100,000 elapsed-time timers without coupling scheduling to rendering or creating 100,000 DOM rows.

## Decision

- Keep the engine framework-independent TypeScript.
- Give a dedicated Web Worker exclusive ownership of engine state.
- Use compact typed-array timer storage with generation-checked slot handles.
- Use an indexed binary min-heap for one-shot deadlines and one worker timeout for the next deadline.
- Transfer bounded typed-array windows to the main thread.
- Use TanStack Svelte Virtual for DOM virtualization.
- Keep simulation metadata out of the timer hot path and derive demo labels from stable slots.

## Consequences

- The engine can be tested without Svelte or a browser.
- Routine UI transport is proportional to the visible page, not the total timer count.
- Worker failure currently loses volatile engine state; automatic replay requires a future durable command log or explicit reinitialization policy.
- Browser throttling can delay deadline delivery; Chronos reports late delivery rather than promising exact callback timing.
