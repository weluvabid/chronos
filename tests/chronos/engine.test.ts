import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualClock } from '../../src/lib/chronos/core/clock.ts';
import { ChronosEngine } from '../../src/lib/chronos/core/engine.ts';
import { ChronosError } from '../../src/lib/chronos/core/types.ts';

test('engine validates deadline handles and exposes scheduler metrics', () => {
  const clock = new ManualClock(100);
  const engine = new ChronosEngine(clock);
  const handle = engine.createTimer(true);
  const eventId = engine.scheduleDeadline(handle, 500, 42);

  assert.equal(engine.metrics().scheduledEvents, 1);
  assert.equal(engine.metrics().nextDeadline, 500);
  assert.equal(engine.cancelDeadline(eventId), true);
  assert.equal(engine.metrics().scheduledEvents, 0);

  engine.release(handle);
  assert.throws(
    () => engine.scheduleDeadline(handle, 600),
    (error: unknown) => error instanceof ChronosError && error.code === 'STALE_HANDLE',
  );
});

test('engine drains scheduled events without mutating elapsed timer state', () => {
  const clock = new ManualClock(10);
  const engine = new ChronosEngine(clock);
  const handle = engine.createTimer(true);

  engine.scheduleDeadline(handle, 20);
  clock.advance(15);

  const due = engine.drainDue();

  assert.equal(due.length, 1);
  assert.equal(engine.elapsed(handle), 15);
  assert.equal(engine.metrics().scheduledEvents, 0);
});
