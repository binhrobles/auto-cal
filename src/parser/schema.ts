import { z } from 'zod';

export const EVENT_TYPES = [
  'flight',
  'reservation',
  'concert',
  'meeting',
  'other',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
    'expected YYYY-MM-DDTHH:MM(:SS), no timezone suffix',
  );

export const ParsedEvent = z
  .object({
    title: z.string().min(1),
    event_type: z.enum(EVENT_TYPES),
    all_day: z.boolean(),
    start: z.string(),
    end: z.string(),
    timezone: z.string().min(1),
    location: z.string().nullable(),
    description: z.string().nullable(),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((e, ctx) => {
    const shape = e.all_day ? isoDate : isoDateTime;
    for (const field of ['start', 'end'] as const) {
      const r = shape.safeParse(e[field]);
      if (!r.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: r.error.issues[0]?.message ?? 'invalid date',
        });
      }
    }
  });
export type ParsedEvent = z.infer<typeof ParsedEvent>;

export const ParsedEmail = z.object({
  events: z.array(ParsedEvent),
});
export type ParsedEmail = z.infer<typeof ParsedEmail>;

export const RECORD_EVENTS_TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    events: {
      type: 'array',
      description:
        'Every distinct event described in the email. A single email may describe multiple events (trip itineraries with outbound + return + hotel, multi-session conferences, dinner + show packages). Return each as a separate item. Never merge them.',
      items: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description:
              'Short calendar title in English, e.g. "Flight SFO → JFK (UA 123)", "Dinner at Gramercy Tavern".',
          },
          event_type: {
            type: 'string',
            enum: [...EVENT_TYPES],
            description: 'Closest category; use "other" if nothing fits.',
          },
          all_day: {
            type: 'boolean',
            description:
              'True for all-day events (conferences without times, hotel check-in days). False when specific times are known.',
          },
          start: {
            type: 'string',
            description:
              'If all_day=true, YYYY-MM-DD. Otherwise YYYY-MM-DDTHH:MM (no timezone suffix — the timezone field carries that).',
          },
          end: {
            type: 'string',
            description: 'Same format as start. Must be strictly after start.',
          },
          timezone: {
            type: 'string',
            description:
              'IANA timezone name (e.g. "America/New_York"). Use the event local timezone, not the user\'s.',
          },
          location: {
            type: ['string', 'null'],
            description: 'Venue, address, or null if unknown.',
          },
          description: {
            type: ['string', 'null'],
            description:
              'Extra detail worth surfacing in the calendar event (confirmation number, PNR, seat, table size). Plain text, no marketing copy.',
          },
          confidence: {
            type: 'number',
            description:
              '0 to 1. How sure are you this is a real scheduled event and the fields are correct? 0.9+ for confirmations, 0.5 for vague date mentions.',
          },
        },
        required: [
          'title',
          'event_type',
          'all_day',
          'start',
          'end',
          'timezone',
          'location',
          'description',
          'confidence',
        ],
      },
    },
  },
  required: ['events'],
};
