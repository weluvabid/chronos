# Development

## Requirements

- Node.js 26 LTS
- pnpm 12

Install and run:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

## Quality checks

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

## Engine tests and benchmark

The engine uses Node's native TypeScript stripping in the configured Node 26 runtime:

```sh
pnpm test
pnpm benchmark
```

Tests use `ManualClock` for deterministic elapsed-time behaviour. The worker runtime is tested through a fake worker port so protocol contracts and bounded-window transport can be exercised without a browser.

## Worker ownership

Create `ChronosWorkerClient` only in browser code. Do not import the worker entrypoint from server-rendered modules. The worker owns timer state; the main thread should interact through the typed client protocol.

## UI data access

The monitor must not request the full timer registry to render a page. Use `QUERY_WINDOW` with a bounded limit. Scroll-driven requests must be coalesced so obsolete windows do not accumulate behind an in-flight worker request. Keep virtual row heights fixed unless variable-height rows are a demonstrated requirement.
