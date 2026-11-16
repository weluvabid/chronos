# Chronos

A browser time coordination engine experiment. Chronos explores timestamp-based elapsed-time
calculation, compact timer storage, centralized scheduling and resilient browser lifecycle handling.

## Stack

- Node.js 26 LTS and pnpm 12
- Astro static site
- Svelte 5 for the demonstration interface
- Iris for shared UI components and theme primitives
- TypeScript for the engine
- Web Worker for centralized scheduling

## Development

```sh
pnpm install --frozen-lockfile
pnpm dev
```
