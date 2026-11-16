import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualClock } from '../../src/lib/chronos/core/clock.ts';
import { ChronosError } from '../../src/lib/chronos/core/types.ts';
import { ChronosEngine } from '../../src/lib/chronos/core/engine.ts';
import { CallCentreSimulation } from '../../src/lib/chronos/simulation/call-centre.ts';

test('100k-agent simulation initializes deterministically and supports churn', () => {
  const first = new CallCentreSimulation(new ChronosEngine(new ManualClock()), 1234);
  const second = new CallCentreSimulation(new ChronosEngine(new ManualClock()), 1234);
  const a = first.initialize(100_000);
  const b = second.initialize(100_000);

  assert.deepEqual(a, b);
  assert.equal(a.agents, 100_000);
  assert.equal(a.running + a.stopped, 100_000);
  const churned = first.churn(25_000);

  assert.equal(churned.agents, 100_000);
  assert.equal(churned.running + churned.paused + churned.stopped, 100_000);
  assert.notDeepEqual(churned, a);
});

test('simulation rejects unsupported sizes and uninitialized churn', () => {
  const simulation = new CallCentreSimulation(new ChronosEngine(new ManualClock()));

  assert.throws(() => simulation.initialize(100_001), RangeError);
  assert.throws(() => simulation.churn(1), /Initialize the simulation/);
});


test('failed simulation initialization rolls back every allocated timer', () => {
  const engine = new ChronosEngine({ now: () => Number.NaN });
  const simulation = new CallCentreSimulation(engine, 1234);

  assert.throws(() => simulation.initialize(1_000), (error: unknown) => error instanceof ChronosError && error.code === 'CLOCK_INVALID');
  assert.equal(engine.timers.size, 0);
  assert.equal(engine.timers.runningCount, 0);
});
