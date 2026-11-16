import { performance } from 'node:perf_hooks';
import { ManualClock } from '../src/lib/chronos/core/clock.ts';
import { ChronosEngine } from '../src/lib/chronos/core/engine.ts';
import { CallCentreSimulation } from '../src/lib/chronos/simulation/call-centre.ts';

const count = Number(process.env.CHRONOS_TIMERS ?? 100_000);
const churnOperations = Number(process.env.CHRONOS_CHURN ?? 25_000);
const clock = new ManualClock(1_000);
const engine = new ChronosEngine(clock);
const simulation = new CallCentreSimulation(engine, 0x00c0ffee);
const measure = (operation) => {
  const start = performance.now();
  const result = operation();

  return { durationMs: Number((performance.now() - start).toFixed(3)), result };
};
const initialization = measure(() => simulation.initialize(count));

clock.advance(1_000);
const churn = measure(() => simulation.churn(churnOperations));
const windowOffset = Math.max(0, Math.min(50_000, count - 256));
const windowLimit = Math.min(256, count);
const window = measure(() => engine.timers.windowBuffers(windowOffset, windowLimit));
const metrics = engine.metrics();

process.stdout.write(`${JSON.stringify({
  environment: { runtime: process.version, platform: process.platform, arch: process.arch },
  workload: { count, churnOperations, seed: simulation.seed },
  timings: {
    initializeMs: initialization.durationMs,
    churnMs: churn.durationMs,
    queryWindowMs: window.durationMs,
  },
  metrics,
  simulation: churn.result,
  window: { records: window.result.slots.length, bytes: window.result.slots.byteLength + window.result.generations.byteLength + window.result.states.byteLength + window.result.elapsedMs.byteLength },
  registryTypedArrayBytes: metrics.capacity * 25,
}, null, 2)}\n`);
