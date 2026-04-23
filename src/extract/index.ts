import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from '../logger.ts';
import type { PendingEmail } from '../sources/types.ts';
import type { ParsedEvent } from '../parser/schema.ts';
import { parseIcs } from './ics.ts';
import { parseEmail } from '../parser/claude.ts';
import { formatHintForPrompt, hintedEventType, type LearnedConfig, hintFor } from '../learned/index.ts';

export interface ExtractOptions {
  email: PendingEmail;
  anthropic: Anthropic;
  logger: Logger;
  learned: LearnedConfig;
}

export async function extractEvents(opts: ExtractOptions): Promise<ParsedEvent[]> {
  const { email, anthropic, logger, learned } = opts;

  if (email.icsAttachments.length > 0) {
    const events: ParsedEvent[] = [];
    for (const ics of email.icsAttachments) {
      try {
        events.push(...parseIcs(ics));
      } catch (err) {
        logger.warn('ics parse failed, falling through to LLM', {
          error: (err as Error).message,
        });
      }
    }
    if (events.length > 0) {
      logger.info('ics fast-path', { eventCount: events.length });
      const defaultType = hintedEventType(hintFor(learned, email.senderDomain));
      if (defaultType) {
        for (const e of events) if (e.event_type === 'other') e.event_type = defaultType;
      }
      return events;
    }
  }

  if (!email.bodyText) {
    logger.warn('no body text and no ics, skipping');
    return [];
  }

  const hint = hintFor(learned, email.senderDomain);
  return parseEmail({
    client: anthropic,
    logger,
    input: {
      sender: email.sender,
      subject: email.subject,
      receivedDate: email.receivedDate,
      body: email.bodyText,
      senderHint: formatHintForPrompt(hint),
    },
  });
}
