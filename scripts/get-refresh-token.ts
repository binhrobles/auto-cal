import { createServer } from 'node:http';
import { google } from 'googleapis';
import { SCOPES } from '../src/google-auth.ts';

const PORT = 8765;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET before running.');
  process.exit(1);
}

const client = new google.auth.OAuth2({
  clientId,
  clientSecret,
  redirectUri: REDIRECT_URI,
});

const authUrl = client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [SCOPES.gmailModify, SCOPES.gmailReadonly, SCOPES.calendarEvents],
});

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith('/callback')) {
    res.writeHead(404).end();
    return;
  }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end('missing code');
    return;
  }
  try {
    const { tokens } = await client.getToken(code);
    res.writeHead(200, { 'content-type': 'text/plain' }).end(
      'Success — you can close this tab. Refresh token written to stdout.',
    );
    console.log('\nPaste this JSON as the Secrets Manager secret value:\n');
    console.log(
      JSON.stringify(
        {
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: tokens.refresh_token,
        },
        null,
        2,
      ),
    );
    server.close(() => process.exit(0));
  } catch (err) {
    res.writeHead(500).end(`token exchange failed: ${(err as Error).message}`);
  }
});

server.listen(PORT, () => {
  console.log(`Listening on ${REDIRECT_URI}`);
  console.log('\nOpen this URL in your browser (note: add the redirect URI to your OAuth client first):\n');
  console.log(authUrl);
});
