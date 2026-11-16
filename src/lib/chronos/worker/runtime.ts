import { PerformanceClock } from '../core/clock.ts';
import { ChronosEngine } from '../core/engine.ts';
import { ChronosError, type TimerHandle } from '../core/types.ts';
import type { ScheduledEvent } from '../scheduler/deadline-queue.ts';
import { CallCentreSimulation } from '../simulation/call-centre.ts';
import { isWorkerRequest, type WorkerRequest, type WorkerResponse } from './protocol.ts';

interface WorkerPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(id: number): void;
}

export function installWorkerRuntime(port: WorkerPort): void {
  const clock = new PerformanceClock();
  const engine = new ChronosEngine(clock);
  let simulation: CallCentreSimulation | null = null;
  let wakeup: number | null = null;
  const respond = (message: WorkerResponse, transfer?: Transferable[]): void => {
    port.postMessage(message, transfer);
  };
  const scheduleNextWakeup = (): void => {
    if (wakeup !== null) {
      port.clearTimeout(wakeup);

      wakeup = null;
    }

    const nextDeadline = engine.deadlines.nextDeadline;

    if (nextDeadline === null) {
      return;
    }

    const delay = Math.max(0, Math.min(2_147_483_647, nextDeadline - clock.now()));

    wakeup = port.setTimeout(drainDueEvents, delay);
  };
  const drainDueEvents = (): void => {
    wakeup = null;

    const events = engine.drainDue(clock.now(), 10_000);
    const validEvents: ScheduledEvent[] = [];
    const invalidCounts = new Map<string, { count: number; message: string }>();

    for (const event of events) {
      try {
        engine.timers.state(event.handle);
        validEvents.push(event);
      } catch (error) {
        const code = error instanceof ChronosError ? error.code : 'RUNTIME_ERROR';
        const message = error instanceof Error ? error.message : 'A scheduled event referenced an invalid timer handle.';
        const current = invalidCounts.get(code);

        if (current === undefined) {
          invalidCounts.set(code, { count: 1, message });
        } else {
          current.count += 1;
        }
      }
    }

    for (const [code, invalid] of invalidCounts) {
      respond({
        version: 1,
        requestId: 0,
        type: 'ERROR',
        code,
        message: `${invalid.count} scheduled event(s) were discarded: ${invalid.message}`,
      });
    }

    if (validEvents.length > 0) {
      respond({ version: 1, requestId: 0, type: 'EVENTS_DUE', events: validEvents });
    }

    scheduleNextWakeup();
  };
  const handleRequest = (request: WorkerRequest): void => {
    try {
      switch (request.type) {
        case 'CREATE_TIMER': {
          const handle = engine.createTimer(request.startImmediately ?? false);

          respond({ version: 1, requestId: request.requestId, type: 'TIMER_CREATED', handle });
          break;
        }
        case 'TIMER_ACTION': {
          applyTimerAction(request.action, request.handle);
          respond({ version: 1, requestId: request.requestId, type: 'ACK' });
          break;
        }
        case 'SCHEDULE_DEADLINE': {
          const eventId = engine.scheduleDeadline(request.handle, clock.now() + request.delayMs, request.payload ?? 0);

          respond({ version: 1, requestId: request.requestId, type: 'ACK', result: eventId });
          scheduleNextWakeup();
          break;
        }
        case 'CANCEL_DEADLINE': {
          const cancelled = engine.cancelDeadline(request.eventId);

          respond({ version: 1, requestId: request.requestId, type: 'ACK', result: cancelled });
          scheduleNextWakeup();
          break;
        }
        case 'QUERY_WINDOW': {
          const window = engine.timers.windowBuffers(request.offset, request.limit);

          respond({ version: 1, requestId: request.requestId, type: 'WINDOW', ...window }, [
            window.slots.buffer, window.generations.buffer, window.states.buffer, window.elapsedMs.buffer,
          ]);
          break;
        }
        case 'METRICS':
          respond({ version: 1, requestId: request.requestId, type: 'METRICS', metrics: engine.metrics() });
          break;
        case 'LOAD_SIMULATION': {
          if (simulation !== null) {
            throw new Error('Simulation has already been initialized.');
          }

          const candidate = new CallCentreSimulation(engine, request.seed);
          const summary = candidate.initialize(request.count);

          simulation = candidate;

          respond({ version: 1, requestId: request.requestId, type: 'SIMULATION', summary });
          break;
        }
        case 'CHURN_SIMULATION': {
          if (simulation === null) {
            throw new Error('Simulation has not been initialized.');
          }

          respond({ version: 1, requestId: request.requestId, type: 'SIMULATION', summary: simulation.churn(request.operations) });
          break;
        }
        case 'RECONCILE':
          drainDueEvents();
          respond({ version: 1, requestId: request.requestId, type: 'ACK' });
          break;
        default: {
          const exhaustive: never = request;

          throw new Error(`Unsupported worker request: ${String(exhaustive)}.`);
        }
      }
    } catch (error) {
      respond({
        version: 1,
        requestId: request.requestId,
        type: 'ERROR',
        code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'WORKER_REQUEST_FAILED',
        message: error instanceof Error ? error.message : 'Unknown worker failure.',
      });
    }
  };
  const applyTimerAction = (action: string, handle: TimerHandle): void => {
    switch (action) {
      case 'start': engine.start(handle);

      return;
      case 'pause': engine.pause(handle);

      return;
      case 'resume': engine.resume(handle);

      return;
      case 'stop': engine.stop(handle);

      return;
      case 'release': engine.release(handle);

      return;
      default: throw new Error(`Unsupported timer action: ${action}.`);
    }
  };

  port.onmessage = (event: MessageEvent<unknown>): void => {
    if (!isWorkerRequest(event.data)) {
      respond({ version: 1, requestId: 0, type: 'ERROR', code: 'INVALID_PROTOCOL_MESSAGE', message: 'Worker received a malformed or unsupported protocol message.' });

      return;
    }

    handleRequest(event.data);
  };

  respond({ version: 1, requestId: 0, type: 'READY' });
}
