import type { Clock } from './clock.ts';
import { ChronosError, TimerState, type TimerHandle, type TimerSnapshot, type TimerWindow } from './types.ts';

const INITIAL_CAPACITY = 1024;
const MAX_CAPACITY = 0x7fffffff;

function readValue<T>(values: ArrayLike<T>, index: number, label: string): T {
  const value = values[index];

  if (value === undefined) {
    throw new ChronosError(`Missing ${label} at index ${index}.`, 'STORAGE_CORRUPT');
  }

  return value;
}

/** Compact timer state. Application metadata deliberately lives outside this hot path. */
export class TimerRegistry {
  #startedAt: Float64Array;
  #accumulated: Float64Array;
  #generation: Uint32Array;
  #state: Uint8Array;
  #freeSlots: Uint32Array;
  #freeCount = 0;
  #capacity: number;
  #liveCount = 0;
  #runningCount = 0;
  #lastClockTime = Number.NEGATIVE_INFINITY;
  readonly #clock: Clock;

  constructor(clock: Clock, initialCapacity = INITIAL_CAPACITY) {
    this.#clock = clock;

    if (!Number.isSafeInteger(initialCapacity) || initialCapacity < 1 || initialCapacity > MAX_CAPACITY) {
      throw new RangeError('Initial capacity must be a positive safe integer within the supported limit.');
    }

    this.#capacity = initialCapacity;
    this.#startedAt = new Float64Array(initialCapacity);
    this.#accumulated = new Float64Array(initialCapacity);
    this.#generation = new Uint32Array(initialCapacity);
    this.#state = new Uint8Array(initialCapacity);
    this.#freeSlots = new Uint32Array(initialCapacity);

    for (let slot = initialCapacity - 1; slot >= 0; slot -= 1) {
      this.#freeSlots[this.#freeCount++] = slot;
    }
  }

  get size(): number { return this.#liveCount; }
  get capacity(): number { return this.#capacity; }
  get runningCount(): number { return this.#runningCount; }

  create(startImmediately = false): TimerHandle {
    if (this.#freeCount === 0) {
      this.#grow();
    }

    const slot = readValue(this.#freeSlots, --this.#freeCount, 'free slot');
    let generation = readValue(this.#generation, slot, 'generation');

    if (generation === 0) {
      generation = 1;
    }

    this.#generation[slot] = generation;
    this.#state[slot] = TimerState.Stopped;
    this.#startedAt[slot] = 0;
    this.#accumulated[slot] = 0;
    this.#liveCount += 1;

    const handle = Object.freeze({ slot, generation });

    if (startImmediately) {
      try {
        this.start(handle);
      } catch (error) {
        this.release(handle);
        throw error;
      }
    }

    return handle;
  }

  start(handle: TimerHandle): void {
    const slot = this.#assertHandle(handle);

    if (this.#state[slot] !== TimerState.Stopped) {
      this.#invalidTransition('start', this.#readState(slot));
    }

    this.#accumulated[slot] = 0;
    this.#startedAt[slot] = this.#clockNow();
    this.#state[slot] = TimerState.Running;
    this.#runningCount += 1;
  }

  pause(handle: TimerHandle): void {
    const slot = this.#assertHandle(handle);

    if (this.#state[slot] !== TimerState.Running) {
      this.#invalidTransition('pause', this.#readState(slot));
    }

    this.#accumulateRunning(slot);

    this.#startedAt[slot] = 0;
    this.#state[slot] = TimerState.Paused;
    this.#runningCount -= 1;
  }

  resume(handle: TimerHandle): void {
    const slot = this.#assertHandle(handle);

    if (this.#state[slot] !== TimerState.Paused) {
      this.#invalidTransition('resume', this.#readState(slot));
    }

    this.#startedAt[slot] = this.#clockNow();
    this.#state[slot] = TimerState.Running;
    this.#runningCount += 1;
  }

  stop(handle: TimerHandle): void {
    const slot = this.#assertHandle(handle);
    const state = this.#readState(slot);

    if (state === TimerState.Running) {
      this.#accumulateRunning(slot);

      this.#startedAt[slot] = 0;
    } else if (state === TimerState.Paused) {
      // Paused time is already accumulated.
    } else {
      this.#invalidTransition('stop', state);
    }

    if (state === TimerState.Running) {
      this.#runningCount -= 1;
    }

    this.#state[slot] = TimerState.Stopped;
  }

  release(handle: TimerHandle): void {
    const slot = this.#assertHandle(handle);

    if (this.#readState(slot) === TimerState.Running) {
      this.#runningCount -= 1;
    }

    this.#state[slot] = TimerState.Free;
    this.#startedAt[slot] = 0;
    this.#accumulated[slot] = 0;

    const generation = readValue(this.#generation, slot, 'generation');
    // Retire a slot at generation exhaustion rather than allowing an ABA collision.
    if (generation !== 0xffffffff) {
      this.#generation[slot] = generation + 1;
      this.#freeSlots[this.#freeCount++] = slot;
    }

    this.#liveCount -= 1;
  }

  elapsed(handle: TimerHandle, at = this.#clockNow()): number {
    const slot = this.#assertHandle(handle);
    const state = this.#readState(slot);

    return this.#elapsedAt(slot, state, at);
  }

  state(handle: TimerHandle): TimerState {
    return this.#readState(this.#assertHandle(handle));
  }

  windowBuffers(offset: number, limit: number, at = this.#clockNow()): {
    readonly offset: number;
    readonly total: number;
    readonly slots: Uint32Array;
    readonly generations: Uint32Array;
    readonly states: Uint8Array;
    readonly elapsedMs: Float64Array;
  } {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError('Offset must be a non-negative safe integer.');
    }

    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10_000) {
      throw new RangeError('Limit must be between 0 and 10000.');
    }

    if (!Number.isFinite(at)) {
      throw new RangeError('Snapshot time must be finite.');
    }

    const count = Math.min(limit, Math.max(0, this.#liveCount - offset));
    const slots = new Uint32Array(count);
    const generations = new Uint32Array(count);
    const states = new Uint8Array(count);
    const elapsedMs = new Float64Array(count);
    let liveBefore = 0;
    let cursor = 0;

    for (let slot = 0; slot < this.#capacity && cursor < count; slot += 1) {
      const state = this.#readState(slot);

      if (state === TimerState.Free) {
        continue;
      }

      if (liveBefore++ < offset) {
        continue;
      }

      slots[cursor] = slot;
      generations[cursor] = readValue(this.#generation, slot, 'generation');
      states[cursor] = state;
      elapsedMs[cursor] = this.#elapsedAt(slot, state, at);
      cursor += 1;
    }

    return { offset, total: this.#liveCount, slots, generations, states, elapsedMs };
  }

  /** Returns a bounded slot-order window; it never materializes the full registry by default. */
  window(offset: number, limit: number, at = this.#clockNow()): TimerWindow {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError('Offset must be a non-negative safe integer.');
    }

    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10_000) {
      throw new RangeError('Limit must be between 0 and 10000.');
    }

    if (!Number.isFinite(at)) {
      throw new RangeError('Snapshot time must be finite.');
    }

    const records: TimerSnapshot[] = [];
    let liveBefore = 0;

    for (let slot = 0; slot < this.#capacity && records.length < limit; slot += 1) {
      const state = this.#readState(slot);

      if (state === TimerState.Free) {
        continue;
      }

      if (liveBefore++ < offset) {
        continue;
      }

      records.push({
        handle: { slot, generation: readValue(this.#generation, slot, 'generation') },
        state,
        elapsedMs: this.#elapsedAt(slot, state, at),
      });
    }

    return { offset, total: this.#liveCount, records };
  }

  #accumulateRunning(slot: number): void {
    const now = this.#clockNow();
    const startedAt = readValue(this.#startedAt, slot, 'start timestamp');
    const accumulated = readValue(this.#accumulated, slot, 'accumulated duration');

    if (now < startedAt) {
      throw new ChronosError('Monotonic clock moved before the timer start.', 'CLOCK_REGRESSION');
    }

    this.#accumulated[slot] = accumulated + now - startedAt;
  }

  #elapsedAt(slot: number, state: TimerState, at: number): number {
    this.#assertTimeAtOrAfterStart(slot, at);
    const accumulated = readValue(this.#accumulated, slot, 'accumulated duration');

    if (state !== TimerState.Running) {
      return accumulated;
    }

    return accumulated + at - readValue(this.#startedAt, slot, 'start timestamp');
  }

  #clockNow(): number {
    const now = this.#clock.now();

    if (!Number.isFinite(now)) {
      throw new ChronosError('Clock returned a non-finite value.', 'CLOCK_INVALID');
    }

    if (now < this.#lastClockTime) {
      throw new ChronosError('Monotonic clock moved backwards.', 'CLOCK_REGRESSION');
    }

    this.#lastClockTime = now;

    return now;
  }

  #readState(slot: number): TimerState {
    const state = readValue(this.#state, slot, 'timer state');

    switch (state) {
      case TimerState.Free:
      case TimerState.Stopped:
      case TimerState.Running:
      case TimerState.Paused:
        return state;
      default:
        throw new ChronosError(`Timer registry contains unknown state ${state} at slot ${slot}.`, 'CORRUPT_STATE');
    }
  }

  #assertTimeAtOrAfterStart(slot: number, at: number): void {
    if (!Number.isFinite(at)) {
      throw new RangeError('Elapsed-time sample must be finite.');
    }

    if (this.#readState(slot) === TimerState.Running && at < readValue(this.#startedAt, slot, 'start timestamp')) {
      throw new ChronosError('Elapsed-time sample predates the timer start.', 'CLOCK_REGRESSION');
    }
  }

  #assertHandle(handle: TimerHandle): number {
    if (typeof handle !== 'object' || handle === null || !Number.isSafeInteger(handle.slot) || handle.slot < 0 || handle.slot >= this.#capacity) {
      throw new ChronosError('Timer handle references an invalid slot.', 'STALE_HANDLE');
    }

    if (readValue(this.#state, handle.slot, 'timer state') === TimerState.Free || readValue(this.#generation, handle.slot, 'generation') !== handle.generation) {
      throw new ChronosError('Timer handle is stale or has already been released.', 'STALE_HANDLE');
    }

    return handle.slot;
  }

  #invalidTransition(action: string, state: TimerState): never {
    const stateName = Object.entries(TimerState).find(([, value]) => value === state)?.[0] ?? String(state);

    throw new ChronosError(`Cannot ${action} a timer in state ${stateName}.`, 'INVALID_TRANSITION');
  }

  #grow(): void {
    if (this.#capacity >= MAX_CAPACITY) {
      throw new ChronosError('Timer registry capacity exhausted.', 'CAPACITY_EXHAUSTED');
    }

    const next = Math.min(MAX_CAPACITY, this.#capacity * 2);
    const copy = <T extends Float64Array | Uint32Array | Uint8Array>(source: T): T => {
      const target = new (source.constructor as { new(length: number): T })(next);

      target.set(source);

      return target;
    };

    this.#startedAt = copy(this.#startedAt);
    this.#accumulated = copy(this.#accumulated);
    this.#generation = copy(this.#generation);
    this.#state = copy(this.#state);

    const free = new Uint32Array(next);

    free.set(this.#freeSlots);

    for (let slot = next - 1; slot >= this.#capacity; slot -= 1) {
      free[this.#freeCount++] = slot;
    }

    this.#freeSlots = free;
    this.#capacity = next;
  }
}
