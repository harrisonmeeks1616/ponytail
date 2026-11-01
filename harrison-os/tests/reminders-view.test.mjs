// Reminder delivery words (public/views/reminders.js): only what was observed, using the real state names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveryWords } from '../public/views/reminders.js';

test('held for quiet hours uses the stored state held_by_policy', () => {
  assert.match(deliveryWords({ state: 'held_by_policy', held_until: 1 }), /Held for quiet hours/);
  assert.doesNotMatch(deliveryWords({ state: 'held_by_policy', held_until: 1 }), /^Sending/);
});

test('each state says no more than was observed', () => {
  assert.match(deliveryWords({ state: 'sent' }), /not proof it showed/);
  assert.match(deliveryWords({ state: 'no_route' }), /no phone is set up/);
  assert.match(deliveryWords({ state: 'failed' }), /failed/);
  assert.match(deliveryWords({ state: 'scheduled', outcome_unknown: true }), /Outcome unknown/);
  assert.equal(deliveryWords({ state: 'scheduled' }), 'Sending.');
  assert.match(deliveryWords({ state: 'received_on_device', received_at: 'x' }), /reported the alert arrived/);
  assert.match(deliveryWords({ state: 'acknowledged', received_at: 'x', acknowledged_at: 'y' }), /opened/);
});
