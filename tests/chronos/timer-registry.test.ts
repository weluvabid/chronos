import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualClock } from '../../src/lib/chronos/core/clock.ts';
import { TimerRegistry } from '../../src/lib/chronos/core/timer-registry.ts';
import { ChronosError, TimerState } from '../../src/lib/chronos/core/types.ts';

test('elapsed time is timestamp-derived and pause/resume preserves accumulated duration', () => {
  const clock = new ManualClock(100);
  const registry = new TimerRegistry(clock, 2);
  const handle = registry.create(true);

  clock.advance(1_250);
  assert.equal(registry.elapsed(handle), 1_250);
  registry.pause(handle);
  clock.advance(5_000);
  assert.equal(registry.elapsed(handle), 1_250);
  registry.resume(handle);
  clock.advance(750);
  assert.equal(registry.elapsed(handle), 2_000);
  registry.stop(handle);
  assert.equal(registry.state(handle), TimerState.Stopped);
  assert.equal(registry.elapsed(handle), 2_000);
});

test('invalid transitions fail loudly and do not mutate timer state', () => {
  const registry = new TimerRegistry(new ManualClock());
  const handle = registry.create();

  assert.throws(() => registry.pause(handle), (error: unknown) => error instanceof ChronosError && error.code === 'INVALID_TRANSITION');
  assert.equal(registry.state(handle), TimerState.Stopped);
  registry.start(handle);
  assert.throws(() => registry.start(handle), (error: unknown) => error instanceof ChronosError && error.code === 'INVALID_TRANSITION');
  assert.equal(registry.runningCount, 1);
});

test('released handles cannot affect a reused slot', () => {
  const registry = new TimerRegistry(new ManualClock(), 1);
  const oldHandle = registry.create(true);

  registry.release(oldHandle);
  const newHandle = registry.create();

  assert.equal(newHandle.slot, oldHandle.slot);
  assert.notEqual(newHandle.generation, oldHandle.generation);
  assert.throws(() => registry.stop(oldHandle), (error: unknown) => error instanceof ChronosError && error.code === 'STALE_HANDLE');
  assert.equal(registry.state(newHandle), TimerState.Stopped);
});

test('registry grows geometrically and returns bounded windows', () => {
  const registry = new TimerRegistry(new ManualClock(), 2);
  const handles = Array.from({ length: 5 }, () => registry.create(true));

  assert.equal(registry.capacity, 8);
  assert.equal(registry.size, 5);
  assert.equal(registry.runningCount, 5);
  const page = registry.windowBuffers(2, 2);

  assert.equal(page.total, 5);
  assert.deepEqual(Array.from(page.slots), [2, 3]);
  assert.equal(page.elapsedMs.length, 2);
  const firstHandle = handles.at(0);
  const secondHandle = handles.at(1);

  assert.ok(firstHandle !== undefined);
  assert.ok(secondHandle !== undefined);
  registry.stop(firstHandle);
  assert.equal(registry.runningCount, 4);
  registry.release(secondHandle);
  assert.equal(registry.size, 4);
  assert.equal(registry.runningCount, 3);
});

test('window limits and offsets reject invalid values', () => {
  const registry = new TimerRegistry(new ManualClock());

  assert.throws(() => registry.windowBuffers(-1, 10), RangeError);
  assert.throws(() => registry.windowBuffers(0, 10_001), RangeError);
});


test('clock regression fails before mutating a running timer', () => {
  let time = 10;
  const clock = { now: () => time };
  const registry = new TimerRegistry(clock);
  const handle = registry.create(true);

  time = 9;

  assert.throws(() => registry.pause(handle), (error: unknown) => error instanceof ChronosError && error.code === 'CLOCK_REGRESSION');
  assert.equal(registry.state(handle), TimerState.Running);
  assert.equal(registry.runningCount, 1);
});

test('failed immediate start rolls allocation back', () => {
  const registry = new TimerRegistry({ now: () => Number.NaN });

  assert.throws(() => registry.create(true), (error: unknown) => error instanceof ChronosError && error.code === 'CLOCK_INVALID');
  assert.equal(registry.size, 0);
  assert.equal(registry.runningCount, 0);
});
