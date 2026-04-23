import ICAL from 'ical.js';
import type { ParsedEvent } from '../parser/schema.ts';

export function parseIcs(icsContent: string): ParsedEvent[] {
  const jcal = ICAL.parse(icsContent);
  const comp = new ICAL.Component(jcal);
  const vevents = comp.getAllSubcomponents('vevent');
  return vevents.map(toParsedEvent);
}

function toParsedEvent(vevent: ICAL.Component): ParsedEvent {
  const event = new ICAL.Event(vevent);
  const allDay = event.startDate.isDate;
  const zoneTzid = event.startDate.zone?.tzid;
  const rawParam = vevent.getFirstProperty('dtstart')?.getParameter('tzid');
  const paramTzid = typeof rawParam === 'string' ? rawParam : rawParam?.[0];
  const timezone =
    zoneTzid && zoneTzid !== 'floating' ? zoneTzid : (paramTzid ?? 'UTC');

  return {
    title: event.summary || '(no title)',
    event_type: 'other',
    all_day: allDay,
    start: formatIcsTime(event.startDate, allDay),
    end: formatIcsTime(event.endDate, allDay),
    timezone,
    location: event.location || null,
    description: event.description || null,
    confidence: 1,
  };
}

function formatIcsTime(time: ICAL.Time, allDay: boolean): string {
  const yyyy = String(time.year).padStart(4, '0');
  const mm = String(time.month).padStart(2, '0');
  const dd = String(time.day).padStart(2, '0');
  if (allDay) return `${yyyy}-${mm}-${dd}`;
  const hh = String(time.hour).padStart(2, '0');
  const mi = String(time.minute).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
