/**
 * Access control for /admin/leads.
 * ---------------------------------------------------------------------------
 * One shared password, held as the LEADS_PASSWORD worker secret, exchanged for
 * a signed cookie.
 *
 * NO SESSION STORE. The cookie carries its own expiry and an HMAC of that
 * expiry, keyed by the password itself — so verifying it is a hash, not a
 * lookup, and there is no KV or D1 row to read on every admin request. Changing
 * the password invalidates every outstanding session for free, because the key
 * that signed them is gone.
 *
 * What this is not: it is a single shared credential with no per-user identity
 * and no audit trail. That is the tradeoff of the "shared password" option —
 * fine for a two-person operation, not for a team that needs to know who
 * deleted a lead. Cloudflare Access in front of /admin is the upgrade path and
 * needs no code change.
 */
import { env as workerEnv } from 'cloudflare:workers';

type Env = { LEADS_PASSWORD?: string };
const env = workerEnv as unknown as Env;

export const COOKIE = 'leads_session';

/** Twelve hours: long enough to work a day, short enough that a stray laptop expires. */
const SESSION_MS = 12 * 60 * 60 * 1000;

const encoder = new TextEncoder();

/** The configured password, or null when the secret is not set. */
export const password = (): string | null => env.LEADS_PASSWORD || null;

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compare without leaking where two strings diverge. A `===` on a MAC lets an
 * attacker walk the signature a byte at a time from response timing.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Whether the submitted password matches. False when no password is configured. */
export async function checkPassword(submitted: string): Promise<boolean> {
  const secret = password();
  if (!secret || !submitted) return false;
  // Hash both sides first so the compare is over fixed-length values and cannot
  // leak the password's length.
  return safeEqual(await sign(submitted, secret), await sign(secret, secret));
}

/** `Set-Cookie` value for a fresh session. */
export async function issueSession(): Promise<string> {
  const secret = password();
  if (!secret) throw new Error('LEADS_PASSWORD is not configured');

  const expires = Date.now() + SESSION_MS;
  const token = `${expires}.${await sign(String(expires), secret)}`;
  return [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
  ].join('; ');
}

/** `Set-Cookie` value that clears the session. */
export const clearSession = (): string =>
  `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

/** Whether this request carries a valid, unexpired session. */
export async function isSignedIn(request: Request): Promise<boolean> {
  const secret = password();
  if (!secret) return false;

  const header = request.headers.get('cookie') ?? '';
  const raw = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw) return false;

  const [expires, mac] = raw.split('.');
  if (!expires || !mac) return false;
  if (!Number(expires) || Number(expires) < Date.now()) return false;

  return safeEqual(mac, await sign(expires, secret));
}
