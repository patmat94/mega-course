import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildStatus, renderPage, dateMD } from '../src/index.js';

const feed = JSON.parse(readFileSync(new URL('../../feed-1.json', import.meta.url), 'utf8').replace(/^﻿/, ''));

test('R-K9R newest first', () => {
  const s = buildStatus(feed);
  assert.equal(s.incidents[0].id, '5214');
  assert.equal(s.incidents.at(-1).id, '5208');
});
test('R-R6H / R-H4X updatedAt is the feed value, UTC with Z', () => {
  assert.equal(buildStatus(feed).updatedAt, feed.updatedAt);
  assert.match(buildStatus(feed).updatedAt, /Z$/);
});
test('R-Z8K month first', () => assert.equal(dateMD('2026-10-12T03:48:00Z'), '10/12'));
test('page: heading, teal, tram 3 note, footer, one row per incident', () => {
  const h = renderPage(buildStatus(feed));
  assert.match(h, /<h1>status for the night<\/h1>/);
  assert.match(h, /#1f9e8f/);
  assert.match(h, /shown on tram 3 boards/);
  assert.match(h, /all times UTC/);
  assert.equal((h.match(/<tr data-line=/g) || []).length, 7);
  assert.match(h, /data-line="tram 3"/);
});
test('last-night keeps only the newest night', () => {
  assert.deepEqual(buildStatus(feed, 'last-night').incidents.map((r) => r.id), ['5214', '5213', '5212', '5211', '5210', '5209']);
});
