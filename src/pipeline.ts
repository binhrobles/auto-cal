import type Anthropic from '@anthropic-ai/sdk';
import type { Logger } from './logger.ts';
import type { EventSource } from './sources/types.ts';
import type { CalendarWriter } from './calendar/google.ts';
import type { LearnedConfig } from './learned/index.ts';
import { extractEvents } from './extract/index.ts';
import { shouldSkip } from './learned/index.ts';

export interface PipelineOptions {
  source: EventSource;
  calendar: CalendarWriter;
  anthropic: Anthropic;
  learned: LearnedConfig;
  logger: Logger;
}

export interface PipelineResult {
  fetched: number;
  succeeded: number;
  skipped: number;
  failed: number;
  eventsWritten: number;
}

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const { source, calendar, anthropic, learned, logger } = opts;
  const pending = await source.fetchPending();
  const result: PipelineResult = {
    fetched: pending.length,
    succeeded: 0,
    skipped: 0,
    failed: 0,
    eventsWritten: 0,
  };

  for (const email of pending) {
    const emailLog = logger.child({
      messageId: email.messageId,
      senderDomain: email.senderDomain,
    });

    if (shouldSkip(learned, email)) {
      emailLog.info('skipped by learned config');
      try {
        await source.ack(email);
        result.skipped += 1;
      } catch (err) {
        emailLog.error('ack failed on skipped email', {
          error: (err as Error).message,
        });
        result.failed += 1;
      }
      continue;
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
      result.succeeded += 1;
      result.eventsWritten += events.length;
    } catch (err) {
      emailLog.error('processing failed, leaving label in place for retry', {
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
      result.failed += 1;
    }
  }

  logger.info('pipeline run complete', { ...result });
  return result;
}
