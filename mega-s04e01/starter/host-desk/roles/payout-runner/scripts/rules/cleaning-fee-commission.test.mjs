import test from 'node:test';
import assert from 'node:assert/strict';
import { cleaningFeePayout } from './cleaning-fee-commission.mjs';

test('commission 0: full fee', () => {
  assert.equal(cleaningFeePayout({ cleaningFee: 40, commissionPct: 0 }), 40);
});

test('commission 15: still full fee', () => {
  assert.equal(cleaningFeePayout({ cleaningFee: 40, commissionPct: 15 }), 40);
});

test('fee 0: nothing', () => {
  assert.equal(cleaningFeePayout({ cleaningFee: 0, commissionPct: 15 }), 0);
});
