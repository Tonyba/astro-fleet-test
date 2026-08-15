/**
 * media-api.ts
 * ------------
 * The endpoint behind the CMS uploader: `/api/media` on every site that stores
 * its images in R2. Three verbs, all of them privileged:
 *
 *   POST   /api/media          multipart upload  -> { value: "r2:<key>", url }
 *   GET    /api/media?prefix=  list the bucket   -> { items: [...] }
 *   DELETE /api/media?key=     remove one object
 *
 * AUTHORISATION IS THE WHOLE POINT OF THIS FILE. An open upload route on a
 * public domain is free hosting for whoever finds it, so every request must
 * carry the same Keystatic session that is allowed to edit content: the
 * `keystatic-gh-access-token` cookie, checked against GitHub for PUSH access to
 * the site's own repo. `astro dev` runs Keystatic in local mode where no such
 * cookie exists and nothing is exposed to the internet, so there the check is
 * skipped — exactly the boundary Keystatic itself draws.
 */
import { resolveStore } from './r2-client.js';
import { toR2Value, extensionOf } from './media-url.js';

export interface MediaHandlerOptions {
  /** Merged environment: `import.meta.env` plus the worker's bindings. */
  env: Record<string, unknown>;
  /** "owner/repo" — the repo a caller must have push access to. */
  repo?: string;
  /** Public bucket origin, for the URL handed back to the CMS. */
  publicBase?: string;
  /** Upload ceiling. Cameras produce 10–15 MB; 25 leaves room without inviting abuse. */
  maxBytes?: number;
  /** True in `astro dev`, where Keystatic runs in local mode and auth is moot. */
  isLocal?: boolean;
}

/** What an editor may upload. Anything else is refused before it reaches R2. */
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/** Filenames become URL path segments — keep them boring. */
function slugifyName(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'image'
  );
}

/** Prefixes come from the field config, but never trust them into a key. */
function sanitisePrefix(prefix: string): string {
  return prefix
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/\/{2,}/g, '/')
    .replace(/^[/-]+|[/-]+$/g, '')
    .slice(0, 120);
}

async function sha8(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)]
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * An SVG is markup, and R2 serves it with its own content type. Even on a
 * separate origin, a scriptable SVG is a liability nobody asked for — and no
 * legitimate icon export contains one.
 */
function svgIsInert(source: string): boolean {
  return !/<script[\s>]|\son\w+\s*=|javascript:/i.test(source);
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

/**
 * One GitHub round trip per token, then remembered for five minutes. Uploading
 * a gallery is a burst of requests from one editor; re-asking GitHub about the
 * same token twenty times in a row would only add latency and rate-limit risk.
 */
const authCache = new Map<string, { allowed: boolean; expires: number }>();
const AUTH_TTL_MS = 5 * 60 * 1000;

async function hasPushAccess(token: string, repo: string): Promise<boolean> {
  const cacheKey = `${repo}:${token.slice(-12)}`;
  const cached = authCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.allowed;

  let allowed = false;
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        authorization: `token ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'astro-fleet-media',
      },
    });
    if (response.ok) {
      const body = (await response.json()) as { permissions?: { push?: boolean } };
      allowed = body.permissions?.push === true;
    }
  } catch {
    allowed = false;
  }

  authCache.set(cacheKey, { allowed, expires: Date.now() + AUTH_TTL_MS });
  return allowed;
}

/**
 * Build the route handler. Each site passes its own env and repo; everything
 * else about the endpoint is identical across the fleet.
 */
export function createMediaHandler(options: MediaHandlerOptions) {
  const {
    env,
    repo,
    publicBase = (env.PUBLIC_MEDIA_BASE_URL as string) ?? (env.MEDIA_BASE_URL as string) ?? '',
    maxBytes = DEFAULT_MAX_BYTES,
    isLocal = false,
  } = options;

  const base = publicBase.replace(/\/+$/, '');
  const urlFor = (key: string) =>
    base ? `${base}/${key.split('/').map(encodeURIComponent).join('/')}` : undefined;

  async function authorise(request: Request): Promise<Response | undefined> {
    if (isLocal) return undefined;

    const token = readCookie(request, 'keystatic-gh-access-token');
    if (!token) return json({ error: 'Not signed in to the CMS.' }, 401);
    if (!repo) {
      return json(
        { error: 'Media uploads are not configured: no repo to check permissions against.' },
        503
      );
    }
    if (!(await hasPushAccess(token, repo))) {
      return json({ error: 'Your GitHub account cannot write to this site.' }, 403);
    }
    return undefined;
  }

  return async function handleMedia(request: Request): Promise<Response> {
    const store = resolveStore(env);
    if (!store) {
      return json(
        {
          error:
            'No R2 bucket configured. Bind one as MEDIA on the worker, or set ' +
            'R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET for local dev.',
        },
        503
      );
    }

    const denied = await authorise(request);
    if (denied) return denied;

    const url = new URL(request.url);

    if (request.method === 'GET') {
      // The CMS bundle is compiled once and shipped to every environment, so it
      // cannot know the bucket's public domain. It asks instead — one cheap
      // lookup that keeps the base URL a deploy-time concern.
      const previewKey = url.searchParams.get('url');
      if (previewKey !== null) {
        return json({ key: previewKey, url: urlFor(previewKey.replace(/^r2:/, '')) });
      }

      const prefix = sanitisePrefix(url.searchParams.get('prefix') ?? '');
      const items = await store.list(prefix ? `${prefix}/` : '', 1000);
      return json({
        items: items.map((item) => ({
          key: item.key,
          value: toR2Value(item.key),
          url: urlFor(item.key),
          size: item.size,
          uploaded: item.uploaded,
        })),
      });
    }

    if (request.method === 'DELETE') {
      const key = url.searchParams.get('key');
      if (!key) return json({ error: 'No key given.' }, 400);
      await store.delete(key.replace(/^r2:/, ''));
      return json({ deleted: key });
    }

    if (request.method !== 'POST') {
      return json({ error: `${request.method} not supported.` }, 405);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ error: 'Expected a multipart upload.' }, 400);
    }

    const file = form.get('file');
    if (!(file instanceof File) && !(file instanceof Blob)) {
      return json({ error: 'No file in the upload.' }, 400);
    }

    const type = (file.type || '').toLowerCase();
    const filename = file instanceof File ? file.name : 'image';
    // Trust the declared type, but let a correct extension rescue a browser
    // that sent application/octet-stream.
    const extension = ALLOWED[type] ?? (Object.values(ALLOWED).includes(extensionOf(filename))
      ? extensionOf(filename)
      : undefined);
    if (!extension) {
      return json(
        { error: `${type || 'That file type'} is not an image this site accepts.` },
        415
      );
    }

    if (file.size > maxBytes) {
      return json(
        {
          error: `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${Math.round(
            maxBytes / 1024 / 1024
          )} MB.`,
        },
        413
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    if (extension === 'svg' && !svgIsInert(new TextDecoder().decode(bytes))) {
      return json({ error: 'That SVG contains script — re-export it without interactivity.' }, 415);
    }

    const prefix = sanitisePrefix((form.get('prefix') as string) ?? 'uploads');
    // Content-addressed suffix: re-uploading the same photo lands on the same
    // key instead of littering the bucket with near-duplicates, and two
    // different photos named IMG_1234.jpg can never collide.
    const key = `${prefix ? `${prefix}/` : ''}${slugifyName(filename)}-${await sha8(
      bytes
    )}.${extension}`;

    await store.put(key, bytes, type || `image/${extension}`);

    return json({
      value: toR2Value(key),
      key,
      url: urlFor(key),
      size: bytes.byteLength,
      contentType: type,
    });
  };
}
