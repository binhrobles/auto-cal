import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parallelMap } from './concurrency.ts';

test('parallelMap preserves order', async () => {
  const items = [1, 2, 3, 4, 5];
  const out = await parallelMap(items, 2, async (n) => n * 10);
  assert.deepEqual(out, [10, 20, 30, 40, 50]);
});

test('parallelMap caps concurrency', async () => {
  let active = 0;
  let maxActive = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);
  await parallelMap(items, 3, async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
  });
  assert.equal(maxActive, 3);
});

test('parallelMap handles empty input', async () => {
  const out = await parallelMap([], 5, async () => 1);
  assert.deepEqual(out, []);
});
