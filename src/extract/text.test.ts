import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBody } from './text.ts';

test('extractBody prefers plaintext', () => {
  const got = extractBody({ text: 'hello world', html: '<p>IGNORED</p>' });
  assert.equal(got, 'hello world');
});

test('extractBody falls back to HTML→text', () => {
  const got = extractBody({ text: null, html: '<p>hello</p><p>world</p>' });
  assert.ok(got?.includes('hello'));
  assert.ok(got?.includes('world'));
});

test('extractBody strips quoted replies', () => {
  const body = [
    'New event: dinner tomorrow',
    '',
    'On Mon, Apr 20, 2026 at 5:00 PM Alice <alice@example.com> wrote:',
    '> previous thread content',
    '> with event from last week',
  ].join('\n');
  const got = extractBody({ text: body, html: null });
  assert.ok(got?.includes('dinner tomorrow'));
  assert.ok(!got?.includes('last week'));
});
