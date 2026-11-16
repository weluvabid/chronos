import { CallState, type CallRecord, type CallState as CallStateValue } from '../simulation/call-centre.ts';

const DEPARTMENTS = ['Support', 'Billing', 'Retention', 'Technical'] as const;

export function elapsedAt(record: Pick<CallRecord, 'startedAt'>, now: number): number {
  return Number.isNaN(record.startedAt) ? 0 : Math.max(0, now - record.startedAt);
}

export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new RangeError('Duration must be a finite, non-negative number.');
  }

  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

export function departmentForAgent(agentIndex: number): string {
  if (!Number.isSafeInteger(agentIndex) || agentIndex < 0) {
    throw new RangeError('Agent index must be a non-negative safe integer.');
  }

  return DEPARTMENTS[agentIndex % DEPARTMENTS.length];
}

export function callStateLabel(state: CallStateValue): string {
  switch (state) {
    case CallState.OnCall: return 'On call';
    case CallState.OnHold: return 'On hold';
    case CallState.Available: return 'Available';
    default: throw new Error(`Unknown call state: ${state}.`);
  }
}
