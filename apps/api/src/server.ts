import dotenv from 'dotenv';
import { Resend } from 'resend';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

if (!process.env.VERCEL) {
dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env'),
  override: true,
});
}

type Message = {
  id: string;
  from: string;
  subject: string;
  text: string;
  receivedAt: string;
  providerMessageId?: string;
};

type Mailbox = {
  id: string;
  address: string;
  createdAt: number;
  messages: Message[];
  accessTokenHash?: string;
};

type Store = {
  mailboxes: Record<string, Mailbox>;
};

const PORT = Number(process.env.PORT || 4000);
const DOMAIN = (process.env.MAIL_DOMAIN || 'demo.factormail.test')
  .trim()
  .toLowerCase();

const ENABLED_DOMAINS = new Set(
  (process.env.MAIL_ENABLED_DOMAINS || DOMAIN)
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
);

const TTL_MINUTES = Math.max(
  5,
  Math.min(1440, Number(process.env.MAILBOX_TTL_MINUTES || 60))
);
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_MESSAGES = 100;
const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = resolve(
  process.env.DATA_FILE || resolve(API_DIR, 'data/store.json')
);
const WEBHOOK_SECRET = process.env.INBOUND_EMAIL_WEBHOOK_SECRET || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY?.trim() || '';
const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET?.trim() || '';
const resendClient = new Resend(RESEND_API_KEY || undefined);
const WEB_ORIGIN = process.env.WEB_ORIGIN || '';
const DEVELOPER_ORIGIN = process.env.DEVELOPER_ORIGIN || '';
const ALLOWED_ORIGINS = new Set(
  [WEB_ORIGIN, DEVELOPER_ORIGIN, ...(process.env.ALLOWED_ORIGINS || '').split(',')]
    .map(value => value.trim().replace(/\/$/, ''))
    .filter(Boolean)
);
const DATABASE_URL = process.env.DATABASE_URL?.trim() || '';
const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    })
  : null;
const STORAGE_BACKEND = pool ? 'postgres' : 'file';

if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(DOMAIN)) {
  throw new Error('MAIL_DOMAIN must be a valid domain name.');
}

if (!pool) {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
}

function loadStore(): Store {
  try {
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
    if (parsed && typeof parsed.mailboxes === 'object') return parsed;
  } catch {
    // A missing file is normal on first startup.
  }

  return { mailboxes: {} };
}

let store: Store = pool ? { mailboxes: {} } : loadStore();
let saveQueue: Promise<void> = Promise.resolve();

function isValidStore(value: unknown): value is Store {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const mailboxes = (value as { mailboxes?: unknown }).mailboxes;
  return Boolean(
    mailboxes &&
    typeof mailboxes === 'object' &&
    !Array.isArray(mailboxes)
  );
}

function persist(): Promise<void> {
  saveQueue = saveQueue.catch(() => undefined).then(async () => {
    if (pool) {
      await pool.query(
        `INSERT INTO factormail_store_snapshot (id, payload, updated_at)
         VALUES (1, $1::jsonb, now())
         ON CONFLICT (id)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
        [JSON.stringify(store)]
      );
      return;
    }

    const snapshot = JSON.stringify(store, null, 2);
    const temporaryFile = `${DATA_FILE}.tmp`;
    writeFileSync(temporaryFile, snapshot, { mode: 0o600 });
    renameSync(temporaryFile, DATA_FILE);
  });

  return saveQueue;
}

async function initializeStorage(): Promise<void> {
  if (!pool) {
    console.log('Using JSON file storage.');
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS factormail_store_snapshot (
      id integer PRIMARY KEY CHECK (id = 1),
      payload jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS factormail_admin_sessions (
      token_hash text PRIMARY KEY,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await pool.query(
    'DELETE FROM factormail_admin_sessions WHERE expires_at <= now()'
  );

  const existing = await pool.query(
    'SELECT payload FROM factormail_store_snapshot WHERE id = 1'
  );

  if (existing.rows.length > 0) {
    const payload: unknown = existing.rows[0].payload;
    if (!isValidStore(payload)) {
      throw new Error('Existing PostgreSQL mailbox snapshot has an invalid format.');
    }
    store = payload;
    console.log('Loaded existing mailbox snapshot from PostgreSQL.');
  } else {
    // Seed only an empty database from the current JSON store.
    const seeded = await pool.query(
      `INSERT INTO factormail_store_snapshot (id, payload, updated_at)
       VALUES (1, $1::jsonb, now())
       ON CONFLICT (id) DO NOTHING
       RETURNING payload`,
      [JSON.stringify(store)]
    );

    if (seeded.rows.length > 0) {
      const payload: unknown = seeded.rows[0].payload;
      if (!isValidStore(payload)) {
        throw new Error('Seeded PostgreSQL snapshot has an invalid format.');
      }
      store = payload;
      console.log('Initialized PostgreSQL from the current JSON store.');
    } else {
      // Another API instance may have initialized the snapshot first.
      const raced = await pool.query(
        'SELECT payload FROM factormail_store_snapshot WHERE id = 1'
      );
      const payload: unknown = raced.rows[0]?.payload;
      if (!isValidStore(payload)) {
        throw new Error('Could not load the initialized PostgreSQL snapshot.');
      }
      store = payload;
      console.log('Loaded PostgreSQL snapshot initialized by another instance.');
    }
  }

  // Apply the existing mailbox expiry policy after loading persistent data.
  if (cleanExpired()) {
    await persist();
  }

  console.log('PostgreSQL storage initialized.');
}

function send(res: any, status: number, data: unknown) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Inbound-Secret, X-Mailbox-Token, Authorization'
  };
  const allowedOrigin = (res as any).__allowedOrigin as string | undefined;
  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  } else if (
    process.env.NODE_ENV !== 'production' &&
    !(res as any).__corsRejected
  ) {
    headers['Access-Control-Allow-Origin'] = '*';
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}
async function readJson(req: any): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body exceeds the 1 MB limit.');
      (error as any).status = 413;
      throw error;
    }

    chunks.push(buffer);
  }

  if (size === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    (error as any).status = 400;
    throw error;
  }
}

async function readRawBody(req: any): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > MAX_BODY_BYTES) {
      const error = new Error('Webhook body exceeds the 1 MB limit.');
      (error as any).status = 413;
      throw error;
    }

    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString('utf8');
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cleanExpired(): boolean {
  const expiry = Date.now() - TTL_MINUTES * 60_000;
  let changed = false;

  for (const [id, mailbox] of Object.entries(store.mailboxes)) {
    if (mailbox.createdAt <= expiry) {
      delete store.mailboxes[id];
      changed = true;
    }
  }

  return changed;
}

const adminSessions = new Map<string, number>();

const requests = new Map<string, { count: number; start: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const current = requests.get(ip);

  if (!current || now - current.start >= 60_000) {
    requests.set(ip, { count: 1, start: now });
    return false;
  }

  current.count += 1;
  return current.count > 60;
}

const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
  const origin = req.headers.origin;
  const normalizedOrigin = typeof origin === 'string'
    ? origin.trim().replace(/\/$/, '')
    : '';

  if (normalizedOrigin && !ALLOWED_ORIGINS.has(normalizedOrigin)) {
    (res as any).__allowedOrigin = undefined;
    (res as any).__corsRejected = true;
    return send(res, 403, { error: 'Origin not allowed.' });
  }

  if (normalizedOrigin) {
    (res as any).__allowedOrigin = normalizedOrigin;
  }

  if (req.method === 'OPTIONS') {
    const headers: Record<string, string> = {
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Inbound-Secret, X-Mailbox-Token, Authorization'
    };
    if (normalizedOrigin) {
      headers['Access-Control-Allow-Origin'] = normalizedOrigin;
    } else if (process.env.NODE_ENV !== 'production') {
      headers['Access-Control-Allow-Origin'] = '*';
    }
    res.writeHead(204, headers);
    return res.end();
  }

  const ip = req.socket.remoteAddress || 'unknown';

  if (rateLimited(ip)) {
    return send(res, 429, {
      error: 'Too many requests. Please try again shortly.'
    });
  }

  let url: URL;

  try {
    url = new URL(req.url || '/', 'http://localhost');
  } catch {
    return send(res, 400, { error: 'Invalid request URL.' });
  }

  const path = url.pathname;

  try {
    if (cleanExpired()) await persist();


    // FACTORMAIL_ADMIN_API_V1
    if (path.startsWith('/api/admin/')) {
      const adminUser = process.env.ADMIN_USERNAME || '';
      const adminPassword = process.env.ADMIN_PASSWORD || '';

      if (req.method === 'POST' && path === '/api/admin/login') {
        if (!adminUser || !adminPassword) {
          return send(res, 503, {
            error: 'Administrator credentials are not configured on the server.'
          });
        }

        const body = await readJson(req);
        const username = typeof body.username === 'string' ? body.username : '';
        const password = typeof body.password === 'string' ? body.password : '';

        if (
          !constantTimeEqual(username, adminUser) ||
          !constantTimeEqual(password, adminPassword)
        ) {
          return send(res, 401, { error: 'Invalid administrator credentials.' });
        }

        const token = randomBytes(32).toString('base64url');
        const tokenHash = createHash('sha256').update(token).digest('hex');
        const expiresAtMs = Date.now() + 8 * 60 * 60 * 1000;

        if (pool) {
          await pool.query(
            `INSERT INTO factormail_admin_sessions (token_hash, expires_at)
             VALUES ($1, $2)
             ON CONFLICT (token_hash)
             DO UPDATE SET expires_at = EXCLUDED.expires_at`,
            [tokenHash, new Date(expiresAtMs)]
          );
        } else {
          adminSessions.set(tokenHash, expiresAtMs);
        }

        return send(res, 200, {
          token,
          expiresAt: new Date(expiresAtMs).toISOString()
        });
      }

      const authorization = String(req.headers.authorization || '');
      const bearer = authorization.startsWith('Bearer ')
        ? authorization.slice(7)
        : '';

      if (!bearer) {
        return send(res, 401, { error: 'Administrator sign-in required.' });
      }

      const tokenHash = createHash('sha256').update(bearer).digest('hex');
      let sessionExpiry: number | undefined;

      if (pool) {
        const result = await pool.query(
          `SELECT expires_at
           FROM factormail_admin_sessions
           WHERE token_hash = $1 AND expires_at > now()`,
          [tokenHash]
        );

        if (result.rows.length > 0) {
          sessionExpiry = new Date(result.rows[0].expires_at).getTime();
        } else {
          await pool.query(
            'DELETE FROM factormail_admin_sessions WHERE token_hash = $1 AND expires_at <= now()',
            [tokenHash]
          );
        }
      } else {
        sessionExpiry = adminSessions.get(tokenHash);
      }

      if (!sessionExpiry || !Number.isFinite(sessionExpiry) || sessionExpiry <= Date.now()) {
        adminSessions.delete(tokenHash);
        return send(res, 401, { error: 'Administrator sign-in required.' });
      }

      if (req.method === 'POST' && path === '/api/admin/logout') {
        if (pool) {
          await pool.query(
            'DELETE FROM factormail_admin_sessions WHERE token_hash = $1',
            [tokenHash]
          );
        }
        adminSessions.delete(tokenHash);
        return send(res, 200, { success: true });
      }

      if (req.method === 'GET' && path === '/api/admin/status') {
        return send(res, 200, {
          api: 'healthy',
          storage: STORAGE_BACKEND,
          domain: DOMAIN,
          mailboxTtlMinutes: TTL_MINUTES,
          inboundConfigured: Boolean(WEBHOOK_SECRET),
          adminSessionExpiresAt: new Date(sessionExpiry).toISOString(),
          timestamp: new Date().toISOString()
        });
      }

      if (req.method === 'GET' && path === '/api/admin/overview') {
        const mailboxes = Object.values(store.mailboxes);
        const messageCount = mailboxes.reduce(
          (total, mailbox) => total + mailbox.messages.length, 0
        );

        return send(res, 200, {
          mailboxCount: mailboxes.length,
          messageCount,
          mailboxesWithMessages: mailboxes.filter(m => m.messages.length > 0).length,
          mailboxCapacity: 5000,
          domain: DOMAIN,
          mailboxTtlMinutes: TTL_MINUTES,
          inboundConfigured: Boolean(WEBHOOK_SECRET),
          storage: STORAGE_BACKEND,
          api: 'healthy',
          timestamp: new Date().toISOString()
        });
      }

      if (req.method === 'GET' && path === '/api/admin/mailboxes') {
        const mailboxes = Object.values(store.mailboxes)
          .map(mailbox => ({
            id: mailbox.id,
            address: mailbox.address,
            createdAt: new Date(mailbox.createdAt).toISOString(),
            expiresAt: new Date(
              mailbox.createdAt + TTL_MINUTES * 60_000
            ).toISOString(),
            messageCount: mailbox.messages.length
          }))
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

        return send(res, 200, { mailboxes });
      }

      const adminMailboxMatch = path.match(
        /^\/api\/admin\/mailboxes\/([a-f0-9]{32})$/
      );

      if (req.method === 'DELETE' && adminMailboxMatch) {
        const id = adminMailboxMatch[1];
        if (!store.mailboxes[id]) {
          return send(res, 404, { error: 'Mailbox not found or already expired.' });
        }

        delete store.mailboxes[id];
        await persist();
        console.log('Administrator removed mailbox:', id);

        return send(res, 200, { success: true });
      }

      return send(res, 404, { error: 'Admin route not found.' });
    }

    if (req.method === 'GET' && (path === '/health' || path === '/api/health')) {
      return send(res, 200, {
        status: 'healthy',
        service: 'factormailservice-api',
        storage: STORAGE_BACKEND,
        timestamp: new Date().toISOString()
      });
    }

    if (req.method === 'GET' && path === '/api/domains') {
      return send(res, 200, {
        domains: [...ENABLED_DOMAINS]
          .sort()
          .map(domain => ({
            domain,
            enabled: ENABLED_DOMAINS.has(domain),
            status: ENABLED_DOMAINS.has(domain) ? 'enabled' : 'pending'
          }))
      });
    }

    if (req.method === 'POST' && path === '/api/mailboxes') {
      if (Object.keys(store.mailboxes).length >= 5000) {
        return send(res, 503, {
          error: 'Mailbox capacity reached. Try again later.'
        });
      }

      const body = await readJson(req);
      const selectedDomain = typeof body.domain === 'string'
        ? body.domain.trim().toLowerCase()
        : DOMAIN;
      const requestedUsername = typeof body.username === 'string'
        ? body.username.trim().toLowerCase()
        : '';
      const local = requestedUsername || randomBytes(10).toString('hex');

      if (!ENABLED_DOMAINS.has(selectedDomain)) {
        return send(res, 400, {
          error: 'That domain is not enabled for email reception yet.'
        });
      }

      if (
        local.length > 64 ||
        !/^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?$/.test(local) ||
        local.includes('..')
      ) {
        return send(res, 400, {
          error: 'Username must be 1–64 characters using letters, numbers, dots, underscores, plus signs, or hyphens.'
        });
      }

      const now = Date.now();
      const id = randomBytes(16).toString('hex');
      const accessToken = randomBytes(32).toString('base64url');
      const accessTokenHash = createHash('sha256').update(accessToken).digest('hex');

      const mailbox: Mailbox = {
        id,
        address: `${local}@${selectedDomain}`,
        createdAt: now,
        messages: [],
        accessTokenHash
      };

      store.mailboxes[id] = mailbox;
      await persist();

      return send(res, 201, {
        id: mailbox.id,
        address: mailbox.address,
        expiresAt: new Date(now + TTL_MINUTES * 60_000).toISOString(),
        messages: [],
        accessToken
      });
    }

    if (req.method === 'POST' && path === '/api/webhooks/resend') {
      if (!RESEND_API_KEY || !RESEND_WEBHOOK_SECRET) {
        return send(res, 503, {
          error: 'Resend webhook integration is not configured.'
        });
      }

      const rawPayload = await readRawBody(req);
      const signatureHeaders = {
        id: String(req.headers['svix-id'] || ''),
        timestamp: String(req.headers['svix-timestamp'] || ''),
        signature: String(req.headers['svix-signature'] || '')
      };

      let event: {
        type?: string;
        data?: { email_id?: string };
      };

      try {
        event = resendClient.webhooks.verify({
          payload: rawPayload,
          headers: signatureHeaders,
          webhookSecret: RESEND_WEBHOOK_SECRET
        }) as typeof event;
      } catch {
        return send(res, 400, { error: 'Invalid Resend webhook signature.' });
      }

      if (event.type !== 'email.received') {
        return send(res, 200, { success: true, ignored: true });
      }

      const emailId = event.data?.email_id;
      if (!emailId || typeof emailId !== 'string') {
        return send(res, 400, { error: 'Missing received email ID.' });
      }

      const received = await resendClient.emails.receiving.get(emailId);
      if (received.error || !received.data) {
        console.error('Resend could not retrieve received email:', received.error);
        return send(res, 502, { error: 'Could not retrieve received email from Resend.' });
      }

      const email = received.data;
      const recipients = Array.isArray(email.to) ? email.to : [];
      const mailbox = Object.values(store.mailboxes).find(item =>
        recipients.some(to => item.address.toLowerCase() === String(to).trim().toLowerCase())
      );

      // A mailbox may have expired between email delivery and webhook processing.
      // Acknowledge it instead of asking Resend to retry an email we cannot store.
      if (!mailbox) {
        return send(res, 200, { success: true, ignored: true, reason: 'No active matching mailbox.' });
      }

      const rawFrom = typeof email.from === 'string' ? email.from.trim() : '';
      const addressMatch = rawFrom.match(/<([^<>]+)>/);
      const from = (addressMatch ? addressMatch[1] : rawFrom).trim();

      if (!from || from.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) {
        return send(res, 400, { error: 'Received email has an invalid sender address.' });
      }

      const subject = typeof email.subject === 'string' ? email.subject : '';
      const text = typeof email.text === 'string'
        ? email.text
        : typeof email.html === 'string'
          ? email.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
          : '';
      const providerMessageId = email.id.slice(0, 255);

      if (subject.length > 998 || text.length > 500_000) {
        return send(res, 413, { error: 'Received email exceeds FactorMail message limits.' });
      }

      if (mailbox.messages.some(item => item.providerMessageId === providerMessageId)) {
        return send(res, 200, { success: true, duplicate: true });
      }

      const message: Message = {
        id: randomBytes(12).toString('hex'),
        from,
        subject: subject || '(no subject)',
        text,
        receivedAt: new Date().toISOString(),
        providerMessageId
      };

      mailbox.messages.unshift(message);
      mailbox.messages = mailbox.messages.slice(0, MAX_MESSAGES);
      await persist();

      return send(res, 200, { success: true, messageId: message.id });
    }

    if (req.method === 'POST' && path === '/api/inbound') {
      if (!WEBHOOK_SECRET) {
        return send(res, 503, {
          error: 'Inbound email integration is not configured.'
        });
      }

      const suppliedSecret = String(req.headers['x-inbound-secret'] || '');

      if (!constantTimeEqual(suppliedSecret, WEBHOOK_SECRET)) {
        return send(res, 401, { error: 'Invalid inbound webhook credential.' });
      }

      const body = await readJson(req);
      const to = typeof body.to === 'string'
        ? body.to.trim().toLowerCase()
        : '';
      const from = typeof body.from === 'string' ? body.from.trim() : '';
      const subject = typeof body.subject === 'string' ? body.subject : '';
      const text = typeof body.text === 'string' ? body.text : '';
      const providerMessageId = typeof body.providerMessageId === 'string'
        ? body.providerMessageId.slice(0, 255)
        : undefined;

      if (
        !to ||
        
        to.length > 254 ||
        !from ||
        from.length > 320 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) ||
        subject.length > 998 ||
        text.length > 500_000
      ) {
        return send(res, 400, { error: 'Invalid inbound message fields.' });
      }

      const mailbox = Object.values(store.mailboxes).find(
        item => item.address.toLowerCase() === to
      );

      if (!mailbox) {
        return send(res, 404, {
          error: 'Recipient mailbox does not exist or has expired.'
        });
      }

      if (
        providerMessageId &&
        mailbox.messages.some(item => item.providerMessageId === providerMessageId)
      ) {
        return send(res, 200, { success: true, duplicate: true });
      }

      const message: Message = {
        id: randomBytes(12).toString('hex'),
        from,
        subject: subject || '(no subject)',
        text,
        receivedAt: new Date().toISOString(),
        ...(providerMessageId ? { providerMessageId } : {})
      };

      mailbox.messages.unshift(message);
      mailbox.messages = mailbox.messages.slice(0, MAX_MESSAGES);
      await persist();

      return send(res, 201, { success: true, messageId: message.id });
    }

    const match = path.match(
      /^\/api\/mailboxes\/([a-f0-9]{32})(?:\/messages\/([a-f0-9]{24}))?$/
    );

    if (match) {
      const [, id, messageId] = match;
      const mailbox = store.mailboxes[id];

      if (!mailbox) {
        return send(res, 404, { error: 'Mailbox not found or expired.' });
      }

      const suppliedToken = String(req.headers['x-mailbox-token'] || '');
      const suppliedHash = createHash('sha256').update(suppliedToken).digest('hex');
      if (
        !mailbox.accessTokenHash ||
        !constantTimeEqual(suppliedHash, mailbox.accessTokenHash)
      ) {
        return send(res, 401, { error: 'Valid mailbox access token required.' });
      }

      if (req.method === 'GET' && messageId) {
        const message = mailbox.messages.find(item => item.id === messageId);

        return message
          ? send(res, 200, message)
          : send(res, 404, { error: 'Message not found.' });
      }

      if (req.method === 'GET') {
        return send(res, 200, {
          id: mailbox.id,
          address: mailbox.address,
          expiresAt: new Date(
            mailbox.createdAt + TTL_MINUTES * 60_000
          ).toISOString(),
          messages: mailbox.messages
        });
      }

      if (req.method === 'DELETE' && !messageId) {
        delete store.mailboxes[id];
        await persist();
        return send(res, 200, { success: true });
      }
    }

    return send(res, 404, { error: 'Route not found.' });
  } catch (error) {
    const status = Number((error as any)?.status) || 500;

    if (status >= 500) {
      console.error('API request failed:', error);
    }

    return send(res, status, {
      error: status >= 500 ? 'Internal server error.' : String((error as Error).message)
    });
  }
};

const server = createServer(requestHandler);

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    await ensureInitialized();
    await requestHandler(req, res);
  } catch (error) {
    console.error('API initialization or request failed.');
    if (!res.headersSent) {
      send(res, 503, { error: 'Service temporarily unavailable.' });
    }
  }
}

if (!process.env.VERCEL) {
const cleanupTimer = setInterval(() => {
  for (const [hash, expiry] of adminSessions) {
    if (expiry <= Date.now()) adminSessions.delete(hash);
  }

  if (cleanExpired()) {
    void persist().catch(error => console.error('Expiry cleanup failed:', error));
  }

  if (requests.size > 10_000) requests.clear();
}, 60_000);

cleanupTimer.unref();
}

let initializationPromise: Promise<void> | null = null;

function ensureInitialized(): Promise<void> {
  if (!initializationPromise) {
    initializationPromise = initializeStorage();
  }
  return initializationPromise;
}

async function startServer(): Promise<void> {
  try {
    await ensureInitialized();

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`FactorMailService API listening on port ${PORT}`);
      console.log(`Mailbox domain: ${DOMAIN}`);
      console.log(`Storage backend: ${STORAGE_BACKEND}`);
      if (!pool) console.log(`Persistent data file: ${DATA_FILE}`);
      console.log(`Inbound webhook: ${WEBHOOK_SECRET ? 'configured' : 'disabled'}`);
    });
  } catch (error) {
    console.error('FactorMailService storage initialization failed.');
    console.error(error instanceof Error ? error.message : 'Unknown startup error');
    await pool?.end().catch(() => undefined);
    process.exitCode = 1;
  }
}

if (!process.env.VERCEL) void startServer();
