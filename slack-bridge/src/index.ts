import { createHmac, randomBytes } from 'node:crypto';
import { App, Assistant } from '@slack/bolt';
import { WebClient } from '@slack/web-api';

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

/** Trim and strip one pair of surrounding quotes (.env / compose). */
function stripOuterQuotes(raw: string): string {
  let v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

function requireSlackToken(name: string, prefix: string): string {
  const raw = process.env[name]?.trim();
  if (!raw) {
    throw new Error(`Missing required env: ${name}`);
  }
  const v = stripOuterQuotes(raw);
  if (!v.startsWith(prefix)) {
    throw new Error(
      `${name} must start with ${prefix}. Often: swapped SLACK_BOT_TOKEN (xoxb) and SLACK_APP_TOKEN (xapp), ` +
        `or pasted Signing Secret by mistake. Current value prefix: ${v.slice(0, 6)}…`
    );
  }
  return v;
}

async function assertBotTokenWorks(token: string): Promise<void> {
  const client = new WebClient(token);
  try {
    const res = await client.auth.test({});
    if (!res.ok) {
      throw new Error(res.error ?? 'not_ok');
    }
  } catch (e) {
    const err = e as { data?: { error?: string }; message?: string };
    const slackErr = err.data?.error;
    throw new Error(
      `Slack rejected SLACK_BOT_TOKEN (${slackErr ?? err.message ?? 'unknown'}). ` +
        'Copy a fresh Bot User OAuth Token from api.slack.com → your app → OAuth & Permissions (xoxb-). ' +
        'After every reinstall to the workspace you must copy the new token. ' +
        'If you use Docker Compose, run compose from the repo root so `.env` is picked up, or export the vars in your shell.'
    );
  }
}

// Token format: base64url(JSON payload) + "." + HMAC-SHA256-base64url(body).
// Keep in sync with signSlackBridgeToken() in pkg/plugin/slacklink_token.go.
function signBridgeToken(secret: string, tid: string, sid: string, oid: number): string {
  const exp = Math.floor(Date.now() / 1000) + 120;
  const payload = { tid, sid, oid, exp };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

const BRIDGE = '/api/plugins/consensys-asko11y-app/resources/api/slack-bridge';

function slackBridgeJsonHeaders(grafanaAuth: string, bridgeSecret: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: grafanaAuth,
    'X-Slack-Bridge-Secret': bridgeSecret,
  };
}

async function grafanaErrorMessage(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { message?: string };
    return (j.message ?? '').trim();
  } catch {
    return '';
  }
}

function pendingFailureHint(status: number, message: string): string {
  const low = message.toLowerCase();
  if (status === 401) {
    const likelyApiKey = !message || low.includes('api key') || low.includes('invalid');
    return likelyApiKey
      ? 'Grafana rejected authorization (401). Set `GRAFANA_USERNAME` + `GRAFANA_PASSWORD` in `.env` (recommended for multi-org), ' +
          'or a valid `GRAFANA_TOKEN`, then restart the bridge.'
      : 'Unauthorized (401): bad Grafana credentials or `SLACK_BRIDGE_SECRET` ≠ plugin `slackBridgeSecret`.';
  }
  if (status === 404) {
    return (
      'Slack bridge not enabled in Grafana (404). Set `slackBridgeSecret` in plugin secure JSON and restart Grafana.'
    );
  }
  return (
    `Link step failed (HTTP ${status})${message ? `: ${message}` : ''}. Check Grafana logs and \`GRAFANA_URL\`.`
  );
}

async function registerPending(
  grafanaUrl: string,
  grafanaAuth: string,
  bridgeSecret: string,
  nonce: string,
  teamId: string,
  slackUserId: string
): Promise<{ ok: true } | { ok: false; hint: string }> {
  const res = await fetch(`${grafanaUrl}${BRIDGE}/pending`, {
    method: 'POST',
    headers: slackBridgeJsonHeaders(grafanaAuth, bridgeSecret),
    body: JSON.stringify({ nonce, teamId, slackUserId }),
  });
  if (res.ok) {
    return { ok: true };
  }
  return { ok: false, hint: pendingFailureHint(res.status, await grafanaErrorMessage(res)) };
}

async function lookupOrgId(
  grafanaUrl: string,
  grafanaAuth: string,
  bridgeSecret: string,
  teamId: string,
  slackUserId: string
): Promise<number | null> {
  const res = await fetch(`${grafanaUrl}${BRIDGE}/lookup`, {
    method: 'POST',
    headers: slackBridgeJsonHeaders(grafanaAuth, bridgeSecret),
    body: JSON.stringify({ teamId, slackUserId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[bridge] lookup failed: HTTP ${res.status} ${body}`);
    return null;
  }
  const data = (await res.json()) as { orgId?: number };
  return typeof data.orgId === 'number' ? data.orgId : null;
}

async function startAgentRun(
  grafanaUrl: string,
  grafanaAuth: string,
  orgId: string,
  bridgeToken: string,
  message: string,
  sessionId?: string
): Promise<{ runId: string; sessionId: string } | { error: string }> {
  const res = await fetch(`${grafanaUrl}${BRIDGE}/agent/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: grafanaAuth,
      'X-Grafana-Org-Id': orgId,
      'X-Slack-Bridge-Token': bridgeToken,
    },
    body: JSON.stringify({ message, sessionId: sessionId || undefined }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[bridge] agent/run failed: HTTP ${res.status} ${body}`);
    return { error: `HTTP ${res.status}` };
  }
  const data = (await res.json()) as { runId?: string; sessionId?: string };
  if (!data.runId) {
    return { error: 'missing runId in response' };
  }
  return { runId: data.runId, sessionId: data.sessionId ?? '' };
}

async function collectAssistantText(
  grafanaUrl: string,
  grafanaAuth: string,
  orgId: string,
  bridgeToken: string,
  runId: string
): Promise<string> {
  const url = `${grafanaUrl}${BRIDGE}/agent/runs/${runId}/events`;
  const res = await fetch(url, {
    headers: {
      Authorization: grafanaAuth,
      'X-Grafana-Org-Id': orgId,
      'X-Slack-Bridge-Token': bridgeToken,
    },
  });
  if (!res.ok || !res.body) {
    console.error(`[bridge] events stream failed: HTTP ${res.status}`);
    return `_(failed to stream response — HTTP ${res.status})_`;
  }
  let text = '';
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const block of parts) {
      for (const line of block.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const ev = JSON.parse(line.slice(6)) as {
              type?: string;
              data?: { content?: string };
            };
            if (ev.type === 'content' && ev.data?.content) {
              text += ev.data.content;
            }
          } catch {
            /* ignore malformed chunk */
          }
        }
      }
    }
  }
  return text.trim();
}

const threadSessions = new Map<string, string>();
const MAX_THREAD_SESSIONS = 512;

function rememberThreadSession(tKey: string, sessionId: string): void {
  threadSessions.set(tKey, sessionId);
  if (threadSessions.size <= MAX_THREAD_SESSIONS) {
    return;
  }
  const overflow = threadSessions.size - MAX_THREAD_SESSIONS + 64;
  let n = 0;
  for (const k of threadSessions.keys()) {
    threadSessions.delete(k);
    if (++n >= overflow) {
      break;
    }
  }
}

function threadKey(teamId: string, threadTs: string): string {
  return `${teamId}:${threadTs}`;
}

type SayFn = (message: string) => Promise<unknown>;

async function sendSetupLink(
  say: SayFn,
  grafanaUrl: string,
  grafanaAppUrl: string,
  grafanaAuth: string,
  bridgeSecret: string,
  teamId: string,
  slackUserId: string,
  orgHint?: string
): Promise<void> {
  const nonce = randomBytes(24).toString('base64url');
  const pending = await registerPending(
    grafanaUrl,
    grafanaAuth,
    bridgeSecret,
    nonce,
    teamId,
    slackUserId
  );
  if (!pending.ok) {
    await say(`Could not start link. ${pending.hint}`);
    return;
  }
  const orgParam = orgHint ? `&org=${encodeURIComponent(orgHint)}` : '';
  const link = `${grafanaAppUrl}/a/consensys-asko11y-app?slack_link=${encodeURIComponent(nonce)}${orgParam}`;
  const orgNote = orgHint ? ` (switch to org \`${orgHint}\` in Grafana before opening)` : '';
  await say(`Open this link while signed into Grafana${orgNote} to connect your Slack account:\n${link}`);
}

type GrafanaBridgeEnv = {
  grafanaUrl: string;
  grafanaAppUrl: string;
  grafanaAuth: string;
  bridgeSecret: string;
};

function buildGrafanaAuth(): string {
  const user = process.env.GRAFANA_USERNAME?.trim();
  const pass = process.env.GRAFANA_PASSWORD?.trim();
  if (user && pass) {
    return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
  }
  const token = process.env.GRAFANA_TOKEN?.trim();
  if (token) {
    return 'Bearer ' + stripOuterQuotes(token);
  }
  throw new Error(
    'Set GRAFANA_USERNAME + GRAFANA_PASSWORD (recommended for multi-org) or GRAFANA_TOKEN.'
  );
}

function readGrafanaBridgeEnv(): GrafanaBridgeEnv {
  const grafanaUrl = requireEnv('GRAFANA_URL').replace(/\/$/, '');
  return {
    grafanaUrl,
    grafanaAppUrl: (process.env.GRAFANA_APP_URL || grafanaUrl).replace(/\/$/, ''),
    grafanaAuth: buildGrafanaAuth(),
    bridgeSecret: stripOuterQuotes(requireEnv('SLACK_BRIDGE_SECRET')),
  };
}

function registerAskO11ySlackRoutes(app: App, env: GrafanaBridgeEnv): void {
  const { grafanaUrl, grafanaAppUrl, grafanaAuth, bridgeSecret } = env;

  app.assistant(
    new Assistant({
      threadStarted: async ({ say, saveThreadContext }) => {
        await say('To link Grafana with your Slack account, send `setup` here.');
        await saveThreadContext();
      },
      threadContextChanged: async ({ saveThreadContext }) => {
        await saveThreadContext();
      },
      userMessage: async ({ message, say, context }) => {
        if (!('text' in message) || typeof message.text !== 'string') {
          return;
        }
        const trimmed = message.text.trim();
        const teamId = context.teamId ?? (message as { team?: string }).team ?? '';
        const slackUserId =
          typeof message.user === 'string' ? message.user : (message as { user?: string }).user ?? '';
        if (!teamId || !slackUserId) {
          return;
        }
        if (trimmed.toLowerCase().startsWith('setup')) {
          const orgHint = trimmed.slice('setup'.length).trim() || undefined;
          await sendSetupLink(say, grafanaUrl, grafanaAppUrl, grafanaAuth, bridgeSecret, teamId, slackUserId, orgHint);
          return;
        }
        // Non-setup message: run the agent if the user is linked.
        const orgIdNum = await lookupOrgId(grafanaUrl, grafanaAuth, bridgeSecret, teamId, slackUserId);
        if (orgIdNum === null) {
          await say('Your Slack account is not linked. Send `setup` here to connect your Grafana account.');
          return;
        }
        const orgId = String(orgIdNum);
        const bridgeTok = signBridgeToken(bridgeSecret, teamId, slackUserId, orgIdNum);
        const threadTs = (message as { thread_ts?: string; ts?: string }).thread_ts ??
          (message as { ts?: string }).ts ?? '';
        const tKey = threadKey(teamId, threadTs);
        const sessionId = threadSessions.get(tKey);
        const started = await startAgentRun(grafanaUrl, grafanaAuth, orgId, bridgeTok, trimmed, sessionId);
        if ('error' in started) {
          await say(`Agent request failed (${started.error}). Check plugin logs.`);
          return;
        }
        if (started.sessionId) {
          rememberThreadSession(tKey, started.sessionId);
        }
        const answer = await collectAssistantText(grafanaUrl, grafanaAuth, orgId, bridgeTok, started.runId);
        await say(answer || '_Done (no text content)._');
      },
    })
  );

  app.message(async ({ message, say, context }) => {
    if (!('text' in message) || typeof message.text !== 'string') {
      return;
    }
    if (!('channel_type' in message) || message.channel_type !== 'im') {
      return;
    }
    if ('thread_ts' in message && message.thread_ts) {
      return;
    }
    const dmTrimmed = message.text.trim();
    if (!dmTrimmed.toLowerCase().startsWith('setup')) {
      return;
    }
    const dmOrgHint = dmTrimmed.slice('setup'.length).trim() || undefined;
    const dm = message as { team?: string; user?: string };
    const teamId = context.teamId ?? dm.team ?? '';
    const slackUserId = dm.user ?? '';
    if (!teamId || !slackUserId) {
      return;
    }
    await sendSetupLink(
      say,
      grafanaUrl,
      grafanaAppUrl,
      grafanaAuth,
      bridgeSecret,
      teamId,
      slackUserId,
      dmOrgHint
    );
  });

  app.event('app_mention', async ({ event, say }) => {
    if (!('text' in event) || typeof event.text !== 'string') {
      return;
    }
    const ev = event as { team?: string; user?: string; text: string };
    const teamId = ev.team ?? '';
    const slackUserId = ev.user ?? '';
    if (!teamId || !slackUserId) {
      return;
    }
    const orgIdNum = await lookupOrgId(grafanaUrl, grafanaAuth, bridgeSecret, teamId, slackUserId);
    if (orgIdNum === null) {
      await say({
        thread_ts: 'thread_ts' in event && event.thread_ts ? event.thread_ts : event.ts,
        text: 'Your Slack user is not linked. DM this bot `setup` and open the Grafana link.',
      });
      return;
    }
    const orgId = String(orgIdNum);
    const bridgeTok = signBridgeToken(bridgeSecret, teamId, slackUserId, orgIdNum);
    const threadTs = 'thread_ts' in event && event.thread_ts ? event.thread_ts : event.ts;
    const tKey = threadKey(teamId, threadTs);
    const sessionId = threadSessions.get(tKey);

    const cleaned = event.text.replace(/<@[^>]+>\s*/g, '').trim();
    if (!cleaned) {
      await say({ thread_ts: threadTs, text: 'Ask a question after mentioning me.' });
      return;
    }

    const started = await startAgentRun(
      grafanaUrl,
      grafanaAuth,
      orgId,
      bridgeTok,
      cleaned,
      sessionId
    );
    if ('error' in started) {
      await say({ thread_ts: threadTs, text: `Agent request failed (${started.error}). Check plugin logs.` });
      return;
    }
    if (started.sessionId) {
      rememberThreadSession(tKey, started.sessionId);
    }
    const answer = await collectAssistantText(
      grafanaUrl,
      grafanaAuth,
      orgId,
      bridgeTok,
      started.runId
    );
    await say({
      thread_ts: threadTs,
      text: answer || '_Done (no text content)._',
    });
  });
}

async function main(): Promise<void> {
  const slackBot = requireSlackToken('SLACK_BOT_TOKEN', 'xoxb-');
  const slackApp = requireSlackToken('SLACK_APP_TOKEN', 'xapp-');
  await assertBotTokenWorks(slackBot);

  const app = new App({
    token: slackBot,
    socketMode: true,
    appToken: slackApp,
  });
  registerAskO11ySlackRoutes(app, readGrafanaBridgeEnv());

  try {
    await app.start();
  } catch (e) {
    const err = e as { data?: { error?: string }; message?: string };
    if (err.data?.error === 'invalid_auth') {
      throw new Error(
        'Slack returned invalid_auth while starting Socket Mode. SLACK_BOT_TOKEN already passed auth.test, so ' +
          'regenerate the App-Level Token (Basic Information → App-Level Tokens) with scope connections:write — ' +
          'xapp- — and set SLACK_APP_TOKEN. Revoked or wrong-workspace tokens cause this.'
      );
    }
    throw e;
  }
}

function writeStartupFailure(message: string): void {
  process.stderr.write(`${message.replace(/\r?\n/g, ' ')}\n`);
}

main().catch((e: unknown) => {
  const message =
    e instanceof Error ? e.message : 'Ask O11y Slack bridge failed to start';
  writeStartupFailure(message);
  process.exit(1);
});
