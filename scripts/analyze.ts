import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import { createLogger } from '../src/logger.ts';
import { buildOAuthClient } from '../src/google-auth.ts';
import { extractBody } from '../src/extract/text.ts';
import { parseEmail } from '../src/parser/claude.ts';
import type { ParsedEvent } from '../src/parser/schema.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEARNED_PATH = resolve(ROOT, 'config/learned.json');
const REPORTS_DIR = resolve(ROOT, 'reports');

const monthsArg = Number(
  process.argv.find((a) => a.startsWith('--months='))?.split('=')[1] ??
    process.argv[process.argv.indexOf('--months') + 1] ??
    12,
);
if (!Number.isFinite(monthsArg) || monthsArg <= 0) {
  console.error('Usage: npm run analyze -- --months 12');
  process.exit(1);
}

const GOOGLE_CLIENT_ID = requireEnv('GOOGLE_CLIENT_ID');
const GOOGLE_CLIENT_SECRET = requireEnv('GOOGLE_CLIENT_SECRET');
const GOOGLE_REFRESH_TOKEN = requireEnv('GOOGLE_REFRESH_TOKEN');
const ANTHROPIC_API_KEY = requireEnv('ANTHROPIC_API_KEY');

const auth = buildOAuthClient({
  client_id: GOOGLE_CLIENT_ID,
  client_secret: GOOGLE_CLIENT_SECRET,
  refresh_token: GOOGLE_REFRESH_TOKEN,
});
const gmail = google.gmail({ version: 'v1', auth });
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
const logger = createLogger({ component: 'analyze' });

const EVENT_CUES = [
  'confirmation',
  'confirmed',
  'reservation',
  'itinerary',
  'booking',
  'booked',
  'ticket',
  'invite',
  'invitation',
  'check-in',
  'flight',
];

interface SenderStats {
  count: number;
  withIcs: number;
  withCues: number;
  subjects: string[];
  sampleIds: string[];
}

async function stage1Metadata(): Promise<Map<string, SenderStats>> {
  const since = new Date();
  since.setMonth(since.getMonth() - monthsArg);
  const q = `after:${Math.floor(since.getTime() / 1000)}`;
  const byDomain = new Map<string, SenderStats>();
  let pageToken: string | undefined = undefined;
  let total = 0;
  do {
    const list: gmail_v1.Schema$ListMessagesResponse = (
      await gmail.users.messages.list({
        userId: 'me',
        q,
        maxResults: 500,
        pageToken,
      })
    ).data;
    const ids = (list.messages ?? []).map((m) => m.id!).filter(Boolean);
    for (const id of ids) {
      const msg = (
        await gmail.users.messages.get({
          userId: 'me',
          id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject'],
        })
      ).data;
      total += 1;
      if (total % 100 === 0) logger.info('analyzed', { total });
      const headers = new Map(
        (msg.payload?.headers ?? []).map((h) => [h.name?.toLowerCase() ?? '', h.value ?? '']),
      );
      const fromHeader = headers.get('from') ?? '';
      const subject = headers.get('subject') ?? '';
      const domain = domainOf(fromHeader);
      if (!domain) continue;
      const hasIcs = hasIcsPart(msg.payload);
      const hasCue = EVENT_CUES.some((cue) => subject.toLowerCase().includes(cue));
      const stats = byDomain.get(domain) ?? {
        count: 0,
        withIcs: 0,
        withCues: 0,
        subjects: [],
        sampleIds: [],
      };
      stats.count += 1;
      if (hasIcs) stats.withIcs += 1;
      if (hasCue) stats.withCues += 1;
      if (stats.subjects.length < 5) stats.subjects.push(subject);
      if (stats.sampleIds.length < 5) stats.sampleIds.push(id);
      byDomain.set(domain, stats);
    }
    pageToken = list.nextPageToken ?? undefined;
  } while (pageToken);
  logger.info('stage 1 complete', { totalMessages: total, domains: byDomain.size });
  return byDomain;
}

interface SampleResult {
  domain: string;
  messageId: string;
  subject: string;
  events: ParsedEvent[];
  error?: string;
}

async function stage2Sample(
  byDomain: Map<string, SenderStats>,
): Promise<SampleResult[]> {
  const candidates = [...byDomain.entries()]
    .filter(([, s]) => s.withCues >= 1 && s.withIcs < s.count)
    .sort((a, b) => b[1].withCues - a[1].withCues)
    .slice(0, 20);

  const results: SampleResult[] = [];
  for (const [domain, stats] of candidates) {
    for (const id of stats.sampleIds.slice(0, 3)) {
      try {
        const full = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
        const headers = new Map(
          (full.data.payload?.headers ?? []).map((h) => [h.name?.toLowerCase() ?? '', h.value ?? '']),
        );
        const bodyParts = flattenParts(full.data.payload);
        const textPart = bodyParts.find((p) => p.mimeType === 'text/plain');
        const htmlPart = bodyParts.find((p) => p.mimeType === 'text/html');
        const body = extractBody({
          text: textPart ? decodePart(textPart) : null,
          html: htmlPart ? decodePart(htmlPart) : null,
        });
        if (!body) {
          results.push({
            domain,
            messageId: id,
            subject: headers.get('subject') ?? '',
            events: [],
            error: 'no body',
          });
          continue;
        }
        const events = await parseEmail({
          client: anthropic,
          logger,
          input: {
            sender: headers.get('from') ?? '',
            subject: headers.get('subject') ?? '',
            receivedDate: headers.get('date') ?? new Date().toISOString(),
            body,
          },
        });
        results.push({
          domain,
          messageId: id,
          subject: headers.get('subject') ?? '',
          events,
        });
      } catch (err) {
        results.push({
          domain,
          messageId: id,
          subject: '',
          events: [],
          error: (err as Error).message,
        });
      }
    }
  }
  return results;
}

function flattenParts(payload: gmail_v1.Schema$MessagePart | undefined): gmail_v1.Schema$MessagePart[] {
  if (!payload) return [];
  const out: gmail_v1.Schema$MessagePart[] = [payload];
  for (const p of payload.parts ?? []) out.push(...flattenParts(p));
  return out;
}

function decodePart(part: gmail_v1.Schema$MessagePart): string | null {
  const data = part.body?.data;
  return data ? Buffer.from(data, 'base64url').toString('utf-8') : null;
}

function hasIcsPart(payload: gmail_v1.Schema$MessagePart | undefined): boolean {
  if (!payload) return false;
  if (payload.mimeType === 'text/calendar') return true;
  return (payload.parts ?? []).some(hasIcsPart);
}

function domainOf(fromHeader: string): string {
  const match = fromHeader.match(/<([^>]+)>/) ?? fromHeader.match(/([^\s]+@[^\s]+)/);
  const addr = match?.[1] ?? '';
  const at = addr.indexOf('@');
  return at >= 0 ? addr.slice(at + 1).toLowerCase() : '';
}

function buildReport(
  stats: Map<string, SenderStats>,
  samples: SampleResult[],
): string {
  const sorted = [...stats.entries()].sort((a, b) => b[1].count - a[1].count);
  const totalMessages = sorted.reduce((acc, [, s]) => acc + s.count, 0);
  const totalWithIcs = sorted.reduce((acc, [, s]) => acc + s.withIcs, 0);

  const lines: string[] = [];
  lines.push(`# auto-cal inbox analysis`, '');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Window: last ${monthsArg} months`);
  lines.push(`Total messages: ${totalMessages}`);
  lines.push(`Unique sender domains: ${sorted.length}`);
  lines.push(`Messages with ICS attachment: ${totalWithIcs} (${pct(totalWithIcs, totalMessages)}%)`);
  lines.push('');
  lines.push('## Top 30 senders by volume', '');
  lines.push('| Domain | Messages | With ICS | With event cue |');
  lines.push('|---|---:|---:|---:|');
  for (const [domain, s] of sorted.slice(0, 30)) {
    lines.push(`| ${domain} | ${s.count} | ${s.withIcs} | ${s.withCues} |`);
  }
  lines.push('');
  lines.push('## Top 20 senders with event cues', '');
  const byCues = [...sorted].sort((a, b) => b[1].withCues - a[1].withCues).slice(0, 20);
  lines.push('| Domain | Messages | With cue | Sample subject |');
  lines.push('|---|---:|---:|---|');
  for (const [domain, s] of byCues) {
    lines.push(`| ${domain} | ${s.count} | ${s.withCues} | ${truncate(s.subjects[0] ?? '', 60)} |`);
  }
  lines.push('');
  lines.push('## LLM sample results', '');
  const byDomainSamples = new Map<string, SampleResult[]>();
  for (const r of samples) {
    const list = byDomainSamples.get(r.domain) ?? [];
    list.push(r);
    byDomainSamples.set(r.domain, list);
  }
  for (const [domain, rs] of byDomainSamples) {
    lines.push(`### ${domain}`, '');
    for (const r of rs) {
      lines.push(`- **${truncate(r.subject, 80)}** — ${r.events.length} event(s)` + (r.error ? ` (error: ${r.error})` : ''));
      for (const e of r.events) {
        lines.push(
          `  - ${e.title} | ${e.event_type} | ${e.start} → ${e.end} ${e.timezone} | conf=${e.confidence.toFixed(2)}`,
        );
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function pct(n: number, d: number): string {
  return d === 0 ? '0' : ((n / d) * 100).toFixed(1);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function buildLearnedConfig(
  stats: Map<string, SenderStats>,
  samples: SampleResult[],
): Record<string, unknown> {
  const icsSenders = [...stats.entries()]
    .filter(([, s]) => s.withIcs >= 3 && s.withIcs / s.count >= 0.5)
    .map(([d]) => d);

  const senderHints: Record<string, unknown> = {};
  const samplesByDomain = new Map<string, SampleResult[]>();
  for (const r of samples) {
    const list = samplesByDomain.get(r.domain) ?? [];
    list.push(r);
    samplesByDomain.set(r.domain, list);
  }
  for (const [domain, rs] of samplesByDomain) {
    const eventCounts = rs.map((r) => r.events.length);
    const multiEventRate = eventCounts.filter((c) => c > 1).length / rs.length;
    const typeCounts = new Map<string, number>();
    for (const r of rs) for (const e of r.events) typeCounts.set(e.event_type, (typeCounts.get(e.event_type) ?? 0) + 1);
    const topType = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topType || multiEventRate >= 0.5) {
      const hint: Record<string, unknown> = {};
      if (topType && topType !== 'other') hint.defaultEventType = topType;
      if (multiEventRate >= 0.5) hint.expectMultiEvent = true;
      if (Object.keys(hint).length > 0) senderHints[domain] = hint;
    }
  }

  const existing = existsSync(LEARNED_PATH)
    ? (JSON.parse(readFileSync(LEARNED_PATH, 'utf-8')) as Record<string, unknown>)
    : {};
  const existingSkip = Array.isArray(existing.skipSenders) ? existing.skipSenders : [];

  return {
    skipSenders: existingSkip,
    senderHints,
    icsSenders,
  };
}

async function main() {
  const stats = await stage1Metadata();
  const samples = await stage2Sample(stats);
  const report = buildReport(stats, samples);
  const learned = buildLearnedConfig(stats, samples);

  mkdirSync(REPORTS_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const reportPath = resolve(REPORTS_DIR, `analysis-${date}.md`);
  writeFileSync(reportPath, report);
  writeFileSync(LEARNED_PATH, JSON.stringify(learned, null, 2) + '\n');

  logger.info('analyze complete', {
    reportPath,
    learnedPath: LEARNED_PATH,
    icsSenderCount: (learned.icsSenders as string[]).length,
    hintCount: Object.keys(learned.senderHints as Record<string, unknown>).length,
  });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return v;
}

await main();
