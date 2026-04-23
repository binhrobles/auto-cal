import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { z } from 'zod';

const client = new SecretsManagerClient({});
const cache = new Map<string, unknown>();

export const GoogleSecret = z.object({
  client_id: z.string(),
  client_secret: z.string(),
  refresh_token: z.string(),
});
export type GoogleSecret = z.infer<typeof GoogleSecret>;

export const AnthropicSecret = z.object({
  api_key: z.string(),
});
export type AnthropicSecret = z.infer<typeof AnthropicSecret>;

async function getSecretString(secretId: string): Promise<string> {
  if (cache.has(secretId)) return cache.get(secretId) as string;
  const resp = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!resp.SecretString) {
    throw new Error(`secret ${secretId} has no SecretString`);
  }
  cache.set(secretId, resp.SecretString);
  return resp.SecretString;
}

export async function getGoogleSecret(secretId: string): Promise<GoogleSecret> {
  const raw = await getSecretString(secretId);
  return GoogleSecret.parse(JSON.parse(raw));
}

export async function getAnthropicSecret(secretId: string): Promise<AnthropicSecret> {
  const raw = await getSecretString(secretId);
  return AnthropicSecret.parse(JSON.parse(raw));
}
