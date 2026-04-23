import Anthropic from '@anthropic-ai/sdk';
import type { Logger } from '../logger.ts';
import {
  ParsedEmail,
  type ParsedEvent,
  RECORD_EVENTS_TOOL_SCHEMA,
} from './schema.ts';
import { SYSTEM_PROMPT, buildUserTurn, type UserTurnInput } from './prompt.ts';

const HAIKU = 'claude-haiku-4-5';
const SONNET = 'claude-sonnet-4-6';
const LOW_CONFIDENCE_THRESHOLD = 0.6;
const MAX_BODY_CHARS = 20_000;

const TOOL: Anthropic.Tool = {
  name: 'record_events',
  description:
    'Record every distinct scheduled event described in the email. Return an empty events array if the email contains no events.',
  input_schema: RECORD_EVENTS_TOOL_SCHEMA as unknown as Anthropic.Tool.InputSchema,
};

export interface ParseOptions {
  client: Anthropic;
  logger: Logger;
  input: UserTurnInput;
}

export async function parseEmail(opts: ParseOptions): Promise<ParsedEvent[]> {
  const firstPass = await callClaude({ ...opts, model: HAIKU });
  const minConfidence = Math.min(
    1,
    ...firstPass.map((e) => e.confidence),
  );
  if (firstPass.length === 0 || minConfidence >= LOW_CONFIDENCE_THRESHOLD) {
    return firstPass;
  }
  opts.logger.info('escalating to sonnet', {
    minConfidence,
    eventCount: firstPass.length,
  });
  return callClaude({ ...opts, model: SONNET });
}

async function callClaude(opts: ParseOptions & { model: string }): Promise<ParsedEvent[]> {
  const { client, logger, input, model } = opts;
  const body =
    input.body.length > MAX_BODY_CHARS
      ? input.body.slice(0, MAX_BODY_CHARS) + '\n[... truncated]'
      : input.body;
  const userTurn = buildUserTurn({ ...input, body });

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [TOOL],
    tool_choice: { type: 'tool', name: 'record_events' },
    messages: [{ role: 'user', content: userTurn }],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error(`claude did not emit a tool_use block (stop_reason=${response.stop_reason})`);
  }

  const parsed = ParsedEmail.safeParse(toolUse.input);
  if (!parsed.success) {
    logger.error('record_events tool input failed schema validation', {
      issues: parsed.error.issues,
      rawInput: toolUse.input,
    });
    throw new Error('record_events output failed schema validation');
  }

  logger.info('parse succeeded', {
    model,
    eventCount: parsed.data.events.length,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    cacheCreationTokens: response.usage.cache_creation_input_tokens ?? 0,
  });

  return parsed.data.events;
}
