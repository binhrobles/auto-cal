# auto-cal

Polls a Gmail label every hour, uses Claude to parse events out of the
messages (or reads ICS attachments directly when present), and writes them to
a single Google Calendar. Labeled messages get relabeled to `auto-cal/processed`
on success.

Handles emails that describe multiple events (trip itineraries with outbound +
return, multi-session conferences, dinner + show packages) — each event gets a
stable idempotency key so Lambda retries don't duplicate.

## Stack

- AWS Lambda (Node.js 22, arm64), EventBridge hourly schedule, AWS SAM.
- Claude Haiku 4.5 default, Sonnet 4.6 retry on low confidence.
- Gmail API + Google Calendar API via one OAuth client (desktop type).
- Secrets Manager for tokens. CloudWatch logs + SQS DLQ.

## One-time setup

1. Google Cloud Console: enable Gmail + Calendar APIs, create a **Desktop**
   OAuth client, add yourself as a test user. Scopes: `gmail.modify`,
   `gmail.readonly` (analyzer only), `calendar.events`.
2. In Gmail, create labels `auto-cal/inbox` and `auto-cal/processed`.
3. `npm install`
4. `npm run get-refresh-token` — spins up a local server on :8765, opens your
   browser, prints a refresh token.
5. Create the secrets:

   ```
   aws secretsmanager create-secret --name auto-cal/google \
     --secret-string '{"client_id":"...","client_secret":"...","refresh_token":"..."}'
   aws secretsmanager create-secret --name auto-cal/anthropic \
     --secret-string '{"api_key":"..."}'
   ```

6. `npm run analyze -- --months 12` — scans your inbox, emits a report to
   `reports/analysis-YYYY-MM-DD.md`, writes per-sender hints to
   `config/learned.json`. Review and commit.
7. `sam build && sam deploy --guided`

## Adding new events

Apply `auto-cal/inbox` to any email (manually, or via a Gmail filter) and wait
up to an hour. Events land on the calendar with a Gmail thread link in the
description.

## Refresh the analyzer

Re-run `npm run analyze` every few months or when a new repeat sender slips
through. `learned.json` is treated like code — review the diff before committing.
