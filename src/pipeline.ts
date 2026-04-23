import type Anthropic from '@anthropic-ai/sdk';
import type { Logger } from './logger.ts';
import type { EventSource, PendingEmail } from './sources/types.ts';
import type { CalendarWriter } from './calendar/google.ts';
import type { LearnedConfig } from './learned/index.ts';
import { extractEvents } from './extract/index.ts';
import { shouldSkip } from './learned/index.ts';
import { parallelMap } from './concurrency.ts';

export interface PipelineOptions {
  source: EventSource;
  calendar: CalendarWriter;
  anthropic: Anthropic;
  learned: LearnedConfig;
  logger: Logger;
  concurrency?: number;
}

export interface PipelineResult {
  fetched: number;
  succeeded: number;
  skipped: number;
  failed: number;
  eventsWritten: number;
}

type PerEmail = { eventsWritten: number; status: 'succeeded' | 'skipped' | 'failed' };

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const { source, calendar, anthropic, learned, logger } = opts;
  const concurrency = Math.max(1, opts.concurrency ?? 5);

  const pending = await source.fetchPending();
  const result: PipelineResult = {
    fetched: pending.length,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    eventsWritten: 0,
  };
  if (pending.length === 0) {
    logger.info('pipeline run complete', { ...result });
    return result;
  }

  const processOne = (email: PendingEmail): Promise<PerEmail> =>
    handleEmail({ email, source, calendar, anthropic, learned, logger });

  // Process the first email alone to warm the Claude prompt cache; without
  // this N concurrent first-calls each pay the cache-write premium. After the
  // first completes the system-prompt cache is populated and the rest can
  // read it concurrently.
  const first = await processOne(pending[0]!);
  tally(result, first);

  const rest = pending.slice(1);
  const restResults = await parallelMap(rest, concurrency, processOne);
  for (const r of restResults) tally(result, r);

  logger.info('pipeline run complete', { ...result, concurrency });
  return result;
}

interface HandleOptions {
  email: PendingEmail;
  source: EventSource;
  calendar: CalendarWriter;
  anthropic: Anthropic;
  learned: LearnedConfig;
  logger: Logger;
}

async function handleEmail(opts: HandleOptions): Promise<PerEmail> {
  const { email, source, calendar, anthropic, learned, logger } = opts;
  const emailLog = logger.child({
    messageId: email.messageId,
    senderDomain: email.senderDomain,
  });

  if (shouldSkip(learned, email)) {
    emailLog.info('skipped by learned config');
    try {
      await source.ack(email);
      return { eventsWritten: 0, status: 'skipped' };
    } catch (err) {
      emailLog.error('ack failed on skipped email', {
        error: (err as Error).message,
      });
      return { eventsWritten: 0, status: 'failed' };
    }
  }

  try {
    const events = await extractEvents({
      email,
      anthropic,
      logger: emailLog,
      learned,
    });
    if (events.length > 0) {
      await calendar.writeEvents(events, {
        sourceId: email.sourceId,
        messageId: email.messageId,
        backLink: email.backLink,
      });
    } else {
      emailLog.info('no events extracted');
    }
    await source.ack(email);
    return { eventsWritten: events.length, status: 'succeeded' };
  } catch (err) {
    emailLog.error('processing failed, leaving label in place for retry', {
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
    return { eventsWritten: 0, status: 'failed' };
  }
}

function tally(result: PipelineResult, r: PerEmail): void {
  result[r.status] += 1;
  result.eventsWritten += r.eventsWritten;
}
