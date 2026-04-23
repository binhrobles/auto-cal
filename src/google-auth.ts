import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { GoogleSecret } from './secrets.ts';

export function buildOAuthClient(secret: GoogleSecret): OAuth2Client {
  const client = new google.auth.OAuth2({
    clientId: secret.client_id,
    clientSecret: secret.client_secret,
  });
  client.setCredentials({ refresh_token: secret.refresh_token });
  return client;
}

export const SCOPES = {
  gmailModify: 'https://www.googleapis.com/auth/gmail.modify',
  gmailReadonly: 'https://www.googleapis.com/auth/gmail.readonly',
  calendarEvents: 'https://www.googleapis.com/auth/calendar.events',
};
