import test from 'node:test';
import assert from 'node:assert/strict';
import { cityTax } from './city-tax.mjs';

test('2 guests, 6 nights: capped at 4 nights = 24', () => {
  assert.equal(cityTax({ nights: 2 + 4, guests: 2, bookedAt: '2026-12-01' }), 24);
});

test('booked 2026-11-16 (before the start date) = 0', () => {
  assert.equal(cityTax({ nights: 6, guests: 2, bookedAt: '2026-11-16' }), 0);
});

test('edge: booked 2026-11-17 counts', () => {
  assert.equal(cityTax({ nights: 6, guests: 2, bookedAt: '2026-11-17' }), 24);
});
