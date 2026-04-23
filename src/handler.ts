import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from './config.ts';
import { createLogger } from './logger.ts';
import { getAnthropicSecret, getGoogleSecret } from './secrets.ts';
import { buildOAuthClient } from './google-auth.ts';
import { GmailSource } from './sources/gmail.ts';
import { CalendarWriter } from './calendar/google.ts';
import { loadLearnedConfig } from './learned/index.ts';
import { runPipeline, type PipelineResult } from './pipeline.ts';

export async function handler(): Promise<PipelineResult> {
  const logger = createLogger({ component: 'handler' });
  const config = loadConfig();

  const [googleSecret, anthropicSecret] = await Promise.all([
    getGoogleSecret(config.GOOGLE_SECRET_ID),
    getAnthropicSecret(config.ANTHROPIC_SECRET_ID),
  ]);

  const auth = buildOAuthClient(googleSecret);
  const anthropic = new Anthropic({ apiKey: anthropicSecret.api_key });
  const learned = loadLearnedConfig();

  const source = new GmailSource({
    auth,
    logger: logger.child({ component: 'gmail' }),
    maxMessages: config.MAX_MESSAGES_PER_RUN,
  });
  const calendar = new CalendarWriter({
    auth,
    calendarId: config.CALENDAR_ID,
    logger: logger.child({ component: 'calendar' }),
  });

  return runPipeline({
    source,
    calendar,
    anthropic,
    learned,
    logger: logger.child({ component: 'pipeline' }),
  });
}
