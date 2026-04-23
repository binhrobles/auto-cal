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

## Continuous deployment

`.github/workflows/deploy.yml` runs on pushes to `main` (plus manual dispatch).
It typechecks, tests, bundles with esbuild, then `sam deploy`s to `us-east-1`.
Auth is via GitHub OIDC — no long-lived AWS keys in the repo.

### One-time AWS setup

Replace `ACCOUNT_ID` with your AWS account ID and adjust the repo in the trust
policy if you forked.

1. Create the GitHub OIDC provider (once per AWS account):

   ```
   aws iam create-open-id-connect-provider \
     --url https://token.actions.githubusercontent.com \
     --client-id-list sts.amazonaws.com \
     --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
   ```

2. Edit `infra/deploy-role-trust-policy.json` — replace `ACCOUNT_ID` with yours.

3. Create the deploy role and attach the permissions policy:

   ```
   aws iam create-role \
     --role-name auto-cal-github-deploy \
     --assume-role-policy-document file://infra/deploy-role-trust-policy.json

   aws iam put-role-policy \
     --role-name auto-cal-github-deploy \
     --policy-name auto-cal-deploy \
     --policy-document file://infra/deploy-role-permissions.json
   ```

4. In the GitHub repo: **Settings → Secrets and variables → Actions → Variables
   (new repository variable)** — add `AWS_DEPLOY_ROLE_ARN` set to
   `arn:aws:iam::ACCOUNT_ID:role/auto-cal-github-deploy`.

5. Push to `main` (or run the workflow manually from the Actions tab).

### Scope

The IAM policy is scoped to `auto-cal`-named resources (function, role, log
group, EventBridge rule, SQS queue) and the SAM-managed artifact bucket. If you
rename the stack, update `infra/deploy-role-permissions.json` to match.

## Adding new events

Apply `auto-cal/inbox` to any email (manually, or via a Gmail filter) and wait
up to an hour. Events land on the calendar with a Gmail thread link in the
description.

## Refresh the analyzer

Re-run `npm run analyze` every few months or when a new repeat sender slips
through. `learned.json` is treated like code — review the diff before committing.
