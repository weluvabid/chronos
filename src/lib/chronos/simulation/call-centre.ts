import { ChronosEngine } from '../core/engine.ts';


export const CallState = Object.freeze({ Available: 0, OnCall: 1, OnHold: 2 } as const);
export type CallState = (typeof CallState)[keyof typeof CallState];

export interface CallRecord {
  readonly handle: number;
  readonly state: CallState;
  readonly startedAt: number;
}

export interface CallWindow {
  readonly offset: number;
  readonly total: number;
  readonly records: readonly CallRecord[];
}

export interface SimulationSummary {
  readonly seed: number;
  readonly agents: number;
  readonly onCall: number;
  readonly onHold: number;
  readonly available: number;
}

/** Deterministic call-centre workload with call status kept outside the timer engine. */
export class CallCentreSimulation {
  #states = new Uint8Array(0);
  #randomState: number;
  #onCall = 0;
  #onHold = 0;
  #available = 0;
  readonly engine: ChronosEngine;
  readonly seed: number;

  constructor(engine: ChronosEngine, seed = 0x00c0ffee) {
    this.engine = engine;
    this.seed = seed;
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Simulation seed must be a uint32.');
    this.#randomState = seed >>> 0 || 1;
  }

  initialize(count: number): SimulationSummary {
    if (!Number.isSafeInteger(count) || count < 0 || count > 100_000) throw new RangeError('Simulation size must be between 0 and 100000.');
    if (this.engine.timers.size !== 0) throw new Error('Simulation can only initialize an empty engine.');
    this.#states = new Uint8Array(count);
    this.#randomState = this.seed >>> 0 || 1;
    this.#onCall = 0; this.#onHold = 0; this.#available = count;
    try {
      for (let i = 0; i < count; i++) {
        const id = this.engine.createTimer();
        if (id !== i) throw new Error(`Timer index ${id} does not match agent index ${i}.`);
        if (this.#next() < 0.78) {
          this.engine.start(id);
          this.#states[i] = CallState.OnCall;
          this.#onCall++;
          this.#available--;
        } else {
          this.#states[i] = CallState.Available;
        }
      }
    } catch (error) {
      this.engine.timers.reset();
      this.#states = new Uint8Array(0);
      this.#onCall = 0;
      this.#onHold = 0;
      this.#available = 0;
      this.#randomState = this.seed >>> 0 || 1;
      throw error;
    }
    return this.summary();
  }

  windowBuffers(offset: number, limit: number): {
    readonly offset: number;
    readonly total: number;
    readonly states: Uint8Array;
    readonly startedAt: Float64Array;
  } {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new RangeError('Offset must be a non-negative safe integer.');
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10_000) throw new RangeError('Limit must be between 0 and 10000.');
    const count = Math.min(limit, Math.max(0, this.#states.length - offset));
    return { offset, total: this.#states.length, states: this.#states.slice(offset, offset + count),
      startedAt: this.engine.timers.windowBuffers(offset, count).startedAt };
  }

  churn(operations: number): SimulationSummary {
    if (!Number.isSafeInteger(operations) || operations < 0 || operations > 1_000_000) throw new RangeError('Churn operations must be between 0 and 1000000.');
    if (this.#states.length === 0 && operations > 0) throw new Error('Initialize the simulation before applying churn.');
    for (let i = 0; i < operations; i++) {
      const index = Math.floor(this.#next() * this.#states.length);
      const state = this.#states[index];
      if (state === CallState.OnCall) {
        this.#states[index] = CallState.OnHold;
        this.#onCall--; this.#onHold++;
      } else if (state === CallState.OnHold) {
        this.#states[index] = CallState.Available;
        this.engine.clear(index);
        this.#onHold--; this.#available++;
      } else if (state === CallState.Available) {
        this.engine.start(index);
        this.#states[index] = CallState.OnCall;
        this.#available--; this.#onCall++;
      } else {
        throw new Error(`Simulation encountered an unknown call state: ${state}.`);
      }
    }
    return this.summary();
  }

  summary(): SimulationSummary {
    if (this.#onCall + this.#onHold + this.#available !== this.#states.length) throw new Error('Simulation state counters are inconsistent with the agent count.');
    return { seed: this.seed, agents: this.#states.length, onCall: this.#onCall, onHold: this.#onHold, available: this.#available };
  }

  #next(): number {
    let value = this.#randomState;
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    this.#randomState = value >>> 0;
    return this.#randomState / 0x1_0000_0000;
  }
}
