# Chronos architecture

Chronos is a browser-side time coordination engine. The timer engine is framework-independent TypeScript; the application shell and demonstration are Astro + Svelte 5.

## Runtime boundaries

```text
Svelte monitor
  ├─ Iris UI primitives
  ├─ TanStack Svelte Virtual
  └─ ChronosWorkerClient
       │ versioned request/response protocol
       ▼
Dedicated Web Worker
  ├─ ChronosEngine
  │   ├─ TimerRegistry (typed-array storage)
  │   └─ DeadlineQueue (indexed binary min-heap)
  └─ CallCentreSimulation
```

The worker owns timer state. The UI owns presentation state and requests a bounded record window. Neither rendering nor elapsed-time display is used as the source of truth for timer time.

## Timer semantics

A timer handle is `{ slot, generation }`. A slot can be reused after release, but its generation changes; stale handles fail with `STALE_HANDLE` rather than mutating a new timer. A slot is retired rather than reused if its 32-bit generation counter is exhausted, preventing an ABA collision.

States:

- `Stopped`: created but not accumulating time; `start` begins at the current monotonic timestamp.
- `Running`: elapsed time is `accumulated + now - startedAt`.
- `Paused`: elapsed time is frozen in `accumulated`; `resume` establishes a new start timestamp.
- `Free`: internal storage state; it is never exposed as a valid timer.

Allowed transitions:

```text
Stopped --start--> Running
Running --pause--> Paused
Paused  --resume-> Running
Running --stop--> Stopped
Paused  --stop--> Stopped
(any live state) --release--> Free
```

Starting a stopped timer resets its elapsed duration. Stopping a paused timer preserves its accumulated duration. Invalid transitions fail loudly and leave state unchanged.

## Storage

The registry uses structure-of-arrays storage:

| Array | Type | Bytes / slot | Purpose |
|---|---:|---:|---|
| start timestamp | `Float64Array` | 8 | Monotonic start timestamp |
| accumulated duration | `Float64Array` | 8 | Frozen elapsed time |
| generation | `Uint32Array` | 4 | Stale-handle protection |
| state | `Uint8Array` | 1 | State machine |
| free slots | `Uint32Array` | 4 | O(1) allocation/release |

The nominal registry storage is 25 bytes per capacity slot, excluding typed-array headers and JavaScript object overhead. Capacity grows geometrically. The simulation's 100,000 timers currently allocate a capacity of 131,072 slots (about 3.125 MiB of typed-array backing storage).

Application metadata is intentionally not stored in the hot timer registry. The demo derives labels from stable slot numbers.

## Deadline scheduler

Elapsed-time display does not require scheduled callbacks. Deadlines are separate one-shot events in an indexed binary min-heap:

- Peek next deadline: O(1)
- Insert: O(log n)
- Cancel by event ID: O(log n)
- Pop due events: O(k log n) for k due events
- Equal deadlines execute in insertion order

The worker maintains one host timeout for the earliest deadline. Due processing is capped at 10,000 events per drain so a burst cannot monopolize the worker indefinitely. If more events remain overdue, the next central wakeup is scheduled immediately.

A due event is a notification, not an implicit timer state transition. The consumer decides what domain action the event represents.

## Worker protocol and data transport

Protocol version 1 uses monotonically increasing request IDs. Request/response operations are correlated; unsolicited runtime events use request ID `0`. The client applies a 15-second request timeout, caps combined queued/in-flight requests at 64, rejects all pending work after worker failure/closure/message deserialization failure, and ignores late responses after timeout. Timed-out commands are not automatically retried: a timeout can be ambiguous for a non-idempotent command.

`SCHEDULE_DEADLINE` accepts a relative delay so the main thread never assumes that its `performance.now()` origin matches the worker's. The worker converts the delay into its own monotonic deadline. `QUERY_WINDOW` returns four transferable typed arrays (`slots`, `generations`, `states`, `elapsedMs`) and the total record count. It is bounded to 10,000 rows at the protocol boundary; the monitor asks for at least 256 rows and extends the window when overscan crosses a page boundary. The current window lookup walks slots in ascending order to skip released slots, so query CPU is O(capacity) while transfer/allocation is O(limit). The worker never pushes the complete registry to the main thread for routine rendering. A dense active-slot index is a future optimization only if measured query cost justifies its extra mutation and ordering complexity.

The Svelte monitor coalesces scroll-driven page requests: while one request is in flight, only the latest requested window is retained. This avoids building a queue of obsolete scroll requests. Visible records are refreshed once per second with one UI-level interval; there are no per-timer intervals.

## Virtualization

The monitor uses TanStack Svelte Virtual with fixed 52px rows and 8 rows of overscan. The virtualizer models all 100,000 logical rows, but the UI data adapter fetches only a bounded window around the virtual range (256 records minimum), extending it when overscan crosses the page boundary. The DOM contains only the visible range plus overscan.

Virtualization controls DOM cardinality; bounded worker queries control transfer volume. Neither alone is sufficient.

## Clock and browser lifecycle

`Clock` is injected into the engine. Production uses `performance.now()`; tests and simulations use `ManualClock`.

The browser may throttle or suspend workers and timers in background tabs or during device sleep. Chronos does not promise exact wall-clock callback delivery. When the page becomes visible or is restored from the back-forward cache, the monitor sends `RECONCILE`, which drains deadlines already due according to the worker's current monotonic clock. A delayed deadline is delivered late, not retroactively on time.

This initial implementation does not attempt to infer system sleep duration from `Date.now()`: wall-clock changes and device sleep cannot be reliably distinguished in all browser environments. Persisted timers and cross-session clock reconciliation are out of scope for this phase.

## Failure model

- Invalid timer transitions: `INVALID_TRANSITION`.
- Released/reused timer handles: `STALE_HANDLE`.
- Unsupported event kinds or worker message shapes: explicit errors.
- Worker request failures: typed error response with code and message.
- Worker crash or request timeout: pending client promises reject.
- Unknown timer states and impossible simulation counters: throw; they are not silently ignored.

Stale scheduled handles are surfaced as unsolicited runtime errors, aggregated by error code per drain so a burst of invalid events cannot flood the main thread. Automatic worker restart/replay is deliberately not implemented yet because the worker currently owns volatile state and there is no durable command log.
