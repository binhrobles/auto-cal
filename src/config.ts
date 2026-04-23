import { z } from 'zod';

const ConfigSchema = z.object({
  GOOGLE_SECRET_ID: z.string(),
  ANTHROPIC_SECRET_ID: z.string(),
  CALENDAR_ID: z.string(),
  MAX_MESSAGES_PER_RUN: z.coerce.number().int().positive().default(100),
});

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  cached = ConfigSchema.parse(process.env);
  return cached;
}
