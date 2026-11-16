import test from 'node:test';
import assert from 'node:assert/strict';
import { departmentForAgent, elapsedAt, formatDuration, callStateLabel } from '../../../src/lib/chronos/dashboard/presentation.ts';
import { CallState } from '../../../src/lib/chronos/simulation/call-centre.ts';

test('elapsed display derives duration from the call start timestamp', () => {
  assert.equal(elapsedAt({ startedAt: 1_000 }, 6_500), 5_500);
  assert.equal(elapsedAt({ startedAt: Number.NaN }, 6_500), 0);
  assert.equal(elapsedAt({ startedAt: 7_000 }, 6_500), 0);
});

test('duration formatting handles hours and rejects invalid values', () => {
  assert.equal(formatDuration(0), '00:00:00');
  assert.equal(formatDuration(3_661_000), '01:01:01');
  assert.throws(() => formatDuration(Number.NaN), RangeError);
  assert.throws(() => formatDuration(-1), RangeError);
});

test('agent departments and call labels are deterministic', () => {
  assert.equal(departmentForAgent(0), 'Support');
  assert.equal(departmentForAgent(4), 'Support');
  assert.equal(callStateLabel(CallState.OnCall), 'On call');
  assert.equal(callStateLabel(CallState.OnHold), 'On hold');
  assert.equal(callStateLabel(CallState.Available), 'Available');
  assert.throws(() => departmentForAgent(-1), RangeError);
});
