import type { Clock } from './clock.ts';
import { TimerRegistry } from './timer-registry.ts';
import type { TimerHandle, TimerSnapshot, TimerWindow } from './types.ts';
import { DeadlineQueue, ScheduledEventKind, type ScheduledEvent } from '../scheduler/deadline-queue.ts';

export interface EngineMetrics {
  readonly timers: number;
  readonly running: number;
  readonly capacity: number;
  readonly scheduledEvents: number;
  readonly nextDeadline: number | null;
}

export class ChronosEngine {
  readonly timers: TimerRegistry;
  readonly deadlines: DeadlineQueue;
  readonly #clock: Clock;

  constructor(clock: Clock, initialCapacity?: number) {
    this.#clock = clock;
    this.timers = new TimerRegistry(clock, initialCapacity);
    this.deadlines = new DeadlineQueue();
  }

  createTimer(startImmediately = false): TimerHandle { return this.timers.create(startImmediately); }
  start(handle: TimerHandle): void { this.timers.start(handle); }
  pause(handle: TimerHandle): void { this.timers.pause(handle); }
  resume(handle: TimerHandle): void { this.timers.resume(handle); }
  stop(handle: TimerHandle): void { this.timers.stop(handle); }
  release(handle: TimerHandle): void { this.timers.release(handle); }
  elapsed(handle: TimerHandle): number { return this.timers.elapsed(handle); }
  snapshot(handle: TimerHandle): TimerSnapshot {
    return { handle, state: this.timers.state(handle), elapsedMs: this.timers.elapsed(handle) };
  }
  window(offset: number, limit: number): TimerWindow { return this.timers.window(offset, limit); }

  scheduleDeadline(handle: TimerHandle, deadline: number, payload = 0): number {
    this.timers.state(handle);

    return this.deadlines.schedule(deadline, ScheduledEventKind.TimerDeadline, handle, payload);
  }
  cancelDeadline(eventId: number): boolean { return this.deadlines.cancel(eventId); }
  drainDue(now = this.#clock.now(), limit = 10_000): ScheduledEvent[] { return this.deadlines.popDue(now, limit); }
  metrics(): EngineMetrics {
    return {
      timers: this.timers.size,
      running: this.timers.runningCount,
      capacity: this.timers.capacity,
      scheduledEvents: this.deadlines.size,
      nextDeadline: this.deadlines.nextDeadline,
    };
  }
}
