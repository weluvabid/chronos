# Performance and measurement

## Initial workload

The deterministic call-centre simulation supports up to 100,000 agents. A seeded xorshift32 generator makes initial state distribution and churn reproducible. The current default is 78% running timers and 22% stopped timers. Churn applies O(1) pause/resume/start transitions to randomly selected agents.

## Benchmark

Run:

```sh
pnpm benchmark
```

Optional workload overrides:

```sh
CHRONOS_TIMERS=100000 CHRONOS_CHURN=25000 pnpm benchmark
```

The benchmark reports the runtime/platform, initialization duration, churn duration, 256-row window-query duration, registry capacity and nominal typed-array backing bytes. It is a Node.js engine benchmark, not a browser or worker benchmark. Do not use it as evidence of UI frame rate, browser memory, or worker message latency.

## Local baseline (this implementation session)

Measured in the provided Linux x64 container on Node.js v22.16.0:

| Operation | Workload | Observed |
|---|---:|---:|
| Initialize | 100,000 timers | 28.265 ms |
| Churn | 25,000 operations | 13.967 ms |
| Query window | 256 records at offset 50,000 | 3.290 ms |
| Typed-array registry | capacity 131,072 | 3,276,800 bytes |
| Transferred page payload | 256 records | 4,352 bytes |

These numbers are a single local run, not statistically significant performance claims. Re-run on target browsers and hardware, warm up the runtime, collect multiple samples and report median/p95 before making public performance claims.

## Next measurements

- Browser worker startup and 100k initialization latency.
- Worker message round-trip latency and query throughput under scroll churn.
- Main-thread long tasks and frame-time distribution while timers are running.
- Heap and ArrayBuffer memory after repeated create/release cycles.
- Deadline insertion/cancellation/drain throughput at 1k, 10k and 100k scheduled events.
- Background-tab suspension, page restore and late-deadline delivery.
- Query-window scan cost under high release/reuse churn; consider a dense active-slot index only if this becomes material.
- Scroll stability when changing query pages and returning to a previous window.

A timing-wheel scheduler should only be considered if measured heap costs are material for the actual deadline distribution.
