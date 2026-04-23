import { google, type gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import type { Logger } from '../logger.ts';
import { extractBody } from '../extract/text.ts';
import type { EventSource, PendingEmail } from './types.ts';

const INBOX_LABEL = 'auto-cal/inbox';
const PROCESSED_LABEL = 'auto-cal/processed';

export interface GmailSourceOptions {
  auth: OAuth2Client;
  logger: Logger;
  maxMessages?: number;
}

export class GmailSource implements EventSource {
  readonly sourceId = 'gmail';
  private readonly gmail: gmail_v1.Gmail;
  private readonly logger: Logger;
  private readonly maxMessages: number;
  private labelIds: { inbox: string; processed: string } | null = null;

  constructor(opts: GmailSourceOptions) {
    this.gmail = google.gmail({ version: 'v1', auth: opts.auth });
    this.logger = opts.logger;
    this.maxMessages = opts.maxMessages ?? 100;
  }

  private async resolveLabels(): Promise<{ inbox: string; processed: string }> {
    if (this.labelIds) return this.labelIds;
    const resp = await this.gmail.users.labels.list({ userId: 'me' });
    const labels = resp.data.labels ?? [];
    const inbox = labels.find((l) => l.name === INBOX_LABEL)?.id;
    const processed = labels.find((l) => l.name === PROCESSED_LABEL)?.id;
    if (!inbox || !processed) {
      throw new Error(
        `required Gmail labels missing: create "${INBOX_LABEL}" and "${PROCESSED_LABEL}" manually`,
      );
    }
    this.labelIds = { inbox, processed };
    return this.labelIds;
  }

  async fetchPending(): Promise<PendingEmail[]> {
    const labels = await this.resolveLabels();
    const list = await this.gmail.users.messages.list({
      userId: 'me',
      labelIds: [labels.inbox],
      maxResults: this.maxMessages,
    });
    const ids = (list.data.messages ?? []).map((m) => m.id!).filter(Boolean);
    this.logger.info('gmail list', { count: ids.length });

    const results: PendingEmail[] = [];
    for (const id of ids) {
      const full = await this.gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'full',
      });
      const parsed = parseMessage(full.data);
      if (parsed) results.push(parsed);
    }
    return results;
  }

  async ack(email: PendingEmail): Promise<void> {
    const labels = await this.resolveLabels();
    await this.gmail.users.messages.modify({
      userId: 'me',
      id: email.messageId,
      requestBody: {
        addLabelIds: [labels.processed],
        removeLabelIds: [labels.inbox],
      },
    });
  }
}

function parseMessage(msg: gmail_v1.Schema$Message): PendingEmail | null {
  if (!msg.id || !msg.threadId) return null;
  const headers = new Map(
    (msg.payload?.headers ?? []).map((h) => [h.name?.toLowerCase() ?? '', h.value ?? '']),
  );
  const sender = headers.get('from') ?? '';
  const subject = headers.get('subject') ?? '(no subject)';
  const dateHeader = headers.get('date');
  const receivedDate = dateHeader
    ? new Date(dateHeader).toISOString()
    : new Date(Number(msg.internalDate ?? Date.now())).toISOString();

  const parts = walkParts(msg.payload);
  const textPart = parts.find((p) => p.mimeType === 'text/plain');
  const htmlPart = parts.find((p) => p.mimeType === 'text/html');
  const icsAttachments = parts
    .filter((p) => p.mimeType === 'text/calendar')
    .map((p) => decodePart(p))
    .filter((s): s is string => !!s);

  const bodyText = extractBody({
    text: textPart ? decodePart(textPart) : null,
    html: htmlPart ? decodePart(htmlPart) : null,
  });

  return {
    sourceId: 'gmail',
    messageId: msg.id,
    threadId: msg.threadId,
    sender,
    senderDomain: domainOf(sender),
    subject,
    receivedDate,
    bodyText,
    icsAttachments,
    backLink: `https://mail.google.com/mail/u/0/#inbox/${msg.threadId}`,
  };
}

function walkParts(payload: gmail_v1.Schema$MessagePart | undefined): gmail_v1.Schema$MessagePart[] {
  if (!payload) return [];
  const out: gmail_v1.Schema$MessagePart[] = [payload];
  for (const part of payload.parts ?? []) {
    out.push(...walkParts(part));
  }
  return out;
}

function decodePart(part: gmail_v1.Schema$MessagePart): string | null {
  const data = part.body?.data;
  if (!data) return null;
  return Buffer.from(data, 'base64url').toString('utf-8');
}

function domainOf(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/) ?? fromHeader.match(/([^\s]+@[^\s]+)/);
  const addr = match?.[1] ?? '';
  const at = addr.indexOf('@');
  return at >= 0 ? addr.slice(at + 1).toLowerCase() : '';
}

export { INBOX_LABEL, PROCESSED_LABEL };
