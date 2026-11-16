import { ChronosEngine } from '../core/engine.ts';
import { TimerState, type TimerHandle } from '../core/types.ts';

export interface SimulationSummary {
  readonly seed: number;
  readonly agents: number;
  readonly running: number;
  readonly paused: number;
  readonly stopped: number;
}

/** Reproducible call-centre workload. Agent labels are derived by the UI from stable slots. */
export class CallCentreSimulation {
  #slots = new Uint32Array(0);
  #generations = new Uint32Array(0);
  #randomState: number;
  #running = 0;
  #paused = 0;
  #stopped = 0;
  readonly engine: ChronosEngine;
  readonly seed: number;

  constructor(engine: ChronosEngine, seed = 0x00c0ffee) {
    this.engine = engine;
    this.seed = seed;

    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError('Simulation seed must be a uint32.');
    }

    this.#randomState = seed >>> 0 || 1;
  }

  initialize(count: number): SimulationSummary {
    if (!Number.isSafeInteger(count) || count < 0 || count > 100_000) {
      throw new RangeError('Simulation size must be between 0 and 100000.');
    }

    if (this.engine.timers.size !== 0) {
      throw new Error('Simulation can only initialize an empty engine.');
    }

    this.#slots = new Uint32Array(count);
    this.#generations = new Uint32Array(count);
    this.#randomState = this.seed >>> 0 || 1;
    this.#running = 0;
    this.#paused = 0;
    this.#stopped = 0;

    let created = 0;

    try {
      for (let i = 0; i < count; i += 1) {
        const handle = this.engine.createTimer();

        this.#slots[i] = handle.slot;
        this.#generations[i] = handle.generation;
        created += 1;
        // A deterministic 78% of agents begin with an active call.
        if (this.#next() < 0.78) {
          this.engine.start(handle);

          this.#running += 1;
        } else {
          this.#stopped += 1;
        }
      }
    } catch (error) {
      const rollbackErrors: unknown[] = [];

      for (let i = 0; i < created; i += 1) {
        try {
          const slot = this.#slots[i];
          const generation = this.#generations[i];

          if (slot === undefined || generation === undefined) {
            throw new Error(`Simulation handle storage is corrupt at index ${i}.`);
          }

          this.engine.release({ slot, generation });
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }

      this.#slots = new Uint32Array(0);
      this.#generations = new Uint32Array(0);
      this.#running = 0;
      this.#paused = 0;
      this.#stopped = 0;
      this.#randomState = this.seed >>> 0 || 1;

      if (rollbackErrors.length > 0) {
        throw new AggregateError([error, ...rollbackErrors], 'Simulation initialization failed and rollback was incomplete.');
      }

      throw error;
    }

    return this.summary();
  }

  /** Applies deterministic state churn; each operation is O(1). */
  churn(operations: number): SimulationSummary {
    if (!Number.isSafeInteger(operations) || operations < 0 || operations > 1_000_000) {
      throw new RangeError('Churn operations must be between 0 and 1000000.');
    }

    if (this.#slots.length === 0 && operations > 0) {
      throw new Error('Initialize the simulation before applying churn.');
    }

    for (let i = 0; i < operations; i += 1) {
      const index = Math.floor(this.#next() * this.#slots.length);
      const slot = this.#slots[index];
      const generation = this.#generations[index];

      if (slot === undefined || generation === undefined) {
        throw new Error(`Simulation handle storage is corrupt at index ${index}.`);
      }

      const handle: TimerHandle = { slot, generation };
      const state = this.engine.timers.state(handle);

      if (state === TimerState.Running) {
        this.engine.pause(handle);

        this.#running -= 1;
        this.#paused += 1;
      } else if (state === TimerState.Paused) {
        this.engine.resume(handle);

        this.#paused -= 1;
        this.#running += 1;
      } else if (state === TimerState.Stopped) {
        this.engine.start(handle);

        this.#stopped -= 1;
        this.#running += 1;
      }
      else {
        throw new Error(`Simulation encountered an impossible timer state: ${state}.`);
      }
    }

    return this.summary();
  }

  summary(): SimulationSummary {
    if (this.#running + this.#paused + this.#stopped !== this.#slots.length) {
      throw new Error('Simulation state counters are inconsistent with the registered agent count.');
    }

    return { seed: this.seed, agents: this.#slots.length, running: this.#running, paused: this.#paused, stopped: this.#stopped };
  }

  #next(): number {
    // xorshift32: deterministic, fast, and sufficient for workload distribution (not cryptography).
    let value = this.#randomState;

    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.#randomState = value >>> 0;

    return this.#randomState / 0x1_0000_0000;
  }
}
