import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentMeeting } from '../src/main/calendar';

test('reunión en curso', () => {
  const m = [{ uid: 'a', title: 'x', start: 100, end: 200 }];
  assert.equal(currentMeeting(m, 99), null);
  assert.equal(currentMeeting(m, 100)?.uid, 'a');
  assert.equal(currentMeeting(m, 200), null);
});
