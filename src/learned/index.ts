import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { EventType } from '../parser/schema.ts';
import { EVENT_TYPES } from '../parser/schema.ts';

const SenderHint = z.object({
  defaultEventType: z.enum(EVENT_TYPES).optional(),
  expectMultiEvent: z.boolean().optional(),
  note: z.string().optional(),
});
export type SenderHint = z.infer<typeof SenderHint>;

const LearnedConfig = z.object({
  skipSenders: z.array(z.string()).default([]),
  senderHints: z.record(SenderHint).default({}),
  icsSenders: z.array(z.string()).default([]),
});
export type LearnedConfig = z.infer<typeof LearnedConfig>;

let cached: LearnedConfig | null = null;

export function loadLearnedConfig(): LearnedConfig {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, '../../config/learned.json');
  const raw = readFileSync(path, 'utf-8');
  cached = LearnedConfig.parse(JSON.parse(raw));
  return cached;
}

export function shouldSkip(config: LearnedConfig, email: { sender: string; senderDomain: string }): boolean {
  const sender = email.sender.toLowerCase();
  return config.skipSenders.some(
    (s) => sender.includes(s.toLowerCase()) || email.senderDomain === s.toLowerCase(),
  );
}

export function hintFor(config: LearnedConfig, senderDomain: string): SenderHint | undefined {
  return config.senderHints[senderDomain.toLowerCase()];
}

export function formatHintForPrompt(hint: SenderHint | undefined): string | undefined {
  if (!hint) return undefined;
  const parts: string[] = [];
  if (hint.defaultEventType) parts.push(`typical event_type: ${hint.defaultEventType}`);
  if (hint.expectMultiEvent) parts.push('often contains multiple events');
  if (hint.note) parts.push(hint.note);
  return parts.length ? parts.join('; ') : undefined;
}

export function hintedEventType(hint: SenderHint | undefined): EventType | undefined {
  return hint?.defaultEventType;
}
