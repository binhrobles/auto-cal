import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs } from './ics.ts';

const SINGLE_EVENT = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:test-1@example.com
SUMMARY:Dinner at Gramercy Tavern
DTSTART;TZID=America/New_York:20260501T193000
DTEND;TZID=America/New_York:20260501T213000
LOCATION:42 E 20th St\\, New York\\, NY
END:VEVENT
END:VCALENDAR`;

const MULTI_EVENT = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:flight-out@ual.com
SUMMARY:UA123 SFO-JFK
DTSTART;TZID=America/Los_Angeles:20260510T080000
DTEND;TZID=America/New_York:20260510T163000
END:VEVENT
BEGIN:VEVENT
UID:flight-ret@ual.com
SUMMARY:UA456 JFK-SFO
DTSTART;TZID=America/New_York:20260515T180000
DTEND;TZID=America/Los_Angeles:20260515T213000
END:VEVENT
END:VCALENDAR`;

const ALL_DAY = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:conf@example.com
SUMMARY:OSS Summit
DTSTART;VALUE=DATE:20260601
DTEND;VALUE=DATE:20260604
END:VEVENT
END:VCALENDAR`;

test('parseIcs: single-event calendar', () => {
  const events = parseIcs(SINGLE_EVENT);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.title, 'Dinner at Gramercy Tavern');
  assert.equal(events[0]!.all_day, false);
  assert.equal(events[0]!.start, '2026-05-01T19:30');
  assert.equal(events[0]!.timezone, 'America/New_York');
});

test('parseIcs: multi-event itinerary yields every VEVENT', () => {
  const events = parseIcs(MULTI_EVENT);
  assert.equal(events.length, 2);
  assert.ok(events[0]!.title.includes('SFO-JFK'));
  assert.ok(events[1]!.title.includes('JFK-SFO'));
});

test('parseIcs: all-day events emit YYYY-MM-DD', () => {
  const events = parseIcs(ALL_DAY);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.all_day, true);
  assert.equal(events[0]!.start, '2026-06-01');
  assert.equal(events[0]!.end, '2026-06-04');
});
