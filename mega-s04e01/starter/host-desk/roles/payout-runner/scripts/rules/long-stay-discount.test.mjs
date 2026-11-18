import { test } from 'node:test';
import assert from 'node:assert/strict';
import { longStayDiscount } from './long-stay-discount.mjs';

test('7 nights gets 10 % off the nights', () => {
  assert.equal(longStayDiscount({ nights: 7, nightlyRate: 100 }), 70);
});

test('6 nights gets no discount', () => {
  assert.equal(longStayDiscount({ nights: 6, nightlyRate: 100 }), 0);
});

test('edge: exactly 7 nights qualifies, 10 nights too', () => {
  assert.equal(longStayDiscount({ nights: 7, nightlyRate: 50 }), 35);
  assert.equal(longStayDiscount({ nights: 10, nightlyRate: 80 }), 80);
});
