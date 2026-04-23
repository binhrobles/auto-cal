import { createHash } from 'node:crypto';
import { google, type calendar_v3 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { Logger } from '../logger.ts';
import type { ParsedEvent, EventType } from '../parser/schema.ts';

const COLOR_BY_TYPE: Record<EventType, string> = {
  flight: '9',
  reservation: '10',
  concert: '3',
  meeting: '7',
  other: '8',
};

export interface CalendarWriterOptions {
  auth: OAuth2Client;
  calendarId: string;
  logger: Logger;
}

export interface EventContext {
  sourceId: string;
  messageId: string;
  backLink: string;
}

export class CalendarWriter {
  private readonly calendar: calendar_v3.Calendar;
  private readonly calendarId: string;
  private readonly logger: Logger;
  private fallbackTimezone: string | null = null;

  constructor(opts: CalendarWriterOptions) {
    this.calendar = google.calendar({ version: 'v3', auth: opts.auth });
    this.calendarId = opts.calendarId;
    this.logger = opts.logger;
  }

  private async getFallbackTimezone(): Promise<string> {
    if (this.fallbackTimezone) return this.fallbackTimezone;
    const resp = await this.calendar.calendars.get({ calendarId: this.calendarId });
    this.fallbackTimezone = resp.data.timeZone ?? 'UTC';
    return this.fallbackTimezone;
  }

  async writeEvents(events: ParsedEvent[], ctx: EventContext): Promise<void> {
    const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
    for (const [i, event] of sorted.entries()) {
      if (event.start >= event.end) {
        throw new Error(`invalid time range: start=${event.start} end=${event.end}`);
      }
      await this.importEvent(event, ctx, i);
    }
  }

  private async importEvent(event: ParsedEvent, ctx: EventContext, index: number): Promise<void> {
    const iCalUID = buildUid(ctx.sourceId, ctx.messageId, index);
    const timezone = event.timezone || (await this.getFallbackTimezone());
    const body: calendar_v3.Schema$Event = {
      iCalUID,
      summary: event.title,
      description: buildDescription(event, ctx),
      location: event.location ?? undefined,
      colorId: COLOR_BY_TYPE[event.event_type],
      extendedProperties: {
        private: {
          eventType: event.event_type,
          sourceId: ctx.sourceId,
          sourceMessageId: ctx.messageId,
          confidence: String(event.confidence),
        },
      },
      start: event.all_day
        ? { date: event.start }
        : { dateTime: event.start, timeZone: timezone },
      end: event.all_day
        ? { date: event.end }
        : { dateTime: event.end, timeZone: timezone },
    };
    await this.calendar.events.import({
      calendarId: this.calendarId,
      requestBody: body,
    });
    this.logger.info('event imported', {
      iCalUID,
      title: event.title,
      eventType: event.event_type,
      confidence: event.confidence,
    });
  }
}

function buildUid(sourceId: string, messageId: string, index: number): string {
  const hash = createHash('sha1').update(`${messageId}:${index}`).digest('hex');
  return `auto-cal-${sourceId}-${hash}@auto-cal`;
}

function buildDescription(event: ParsedEvent, ctx: EventContext): string {
  const lines: string[] = [];
  if (event.description) lines.push(event.description, '');
  lines.push(`Source: ${ctx.backLink}`);
  lines.push(`Confidence: ${event.confidence.toFixed(2)}`);
  return lines.join('\n');
}
