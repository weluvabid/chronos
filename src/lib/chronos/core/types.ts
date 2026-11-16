export const TimerState = Object.freeze({
  Free: 0,
  Stopped: 1,
  Running: 2,
  Paused: 3,
} as const);

export type TimerState = (typeof TimerState)[keyof typeof TimerState];

export interface TimerHandle {
  readonly slot: number;
  readonly generation: number;
}

export interface TimerSnapshot {
  readonly handle: TimerHandle;
  readonly state: TimerState;
  readonly elapsedMs: number;
}

export interface TimerWindow {
  readonly offset: number;
  readonly total: number;
  readonly records: readonly TimerSnapshot[];
}

export type TimerTransition = 'start' | 'pause' | 'resume' | 'stop';

export class ChronosError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);

    this.name = 'ChronosError';
    this.code = code;
  }
}
