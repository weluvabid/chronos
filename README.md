# Chronos

A browser time coordination engine experiment. Chronos coordinates large populations of elapsed-time timers and one-shot deadlines without creating a callback per timer or rendering every record into the DOM.

## Architecture

- Framework-independent TypeScript timer engine.
- Dedicated Web Worker owns timer state and the centralized deadline scheduler.
- Compact typed-array timer registry with generation-checked handles.
- Indexed binary min-heap for one-shot deadline events.
- Versioned request/response worker protocol with bounded typed-array window transfers.
- Svelte 5 monitor uses Iris components and TanStack Virtual to render only visible rows plus overscan.
- Deterministic call-centre simulation supports up to 100,000 agents and repeatable churn.

## Stack

- Node.js 26 LTS and pnpm 12
- Astro static site
- Svelte 5
- Iris UI library
- TanStack Svelte Virtual
- TypeScript and Web Workers

## Development

```sh
pnpm install --frozen-lockfile
pnpm dev
```

## Verification

```sh
pnpm check
pnpm benchmark
```

The benchmark is a local Node.js engine microbenchmark, not a browser performance claim. See [architecture](docs/architecture.md) and [performance notes](docs/performance.md) for design constraints and the measured baseline.
