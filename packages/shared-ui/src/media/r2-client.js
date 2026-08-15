/**
 * r2-client.js
 * ------------
 * One R2 accessor for the three places that need it: the worker (which has a
 * bucket BINDING), `astro dev` (Node, no binding — talks to the same bucket
 * over R2's S3-compatible API), and `scripts/migrate-media-to-r2.mjs` (plain
 * Node). That is why this file is JavaScript with JSDoc types rather than
 * TypeScript: Node imports it directly, Vite and `astro check` still type it.
 *
 * SigV4 is signed by hand with Web Crypto — present in workerd and in Node 18+
 * — so no aws-sdk lands in the worker bundle for the sake of four requests.
 *
 * Nothing here is public-facing: the bucket is read through its own public
 * domain (see media-url.ts), and these credentials only ever write.
 */

/**
 * @typedef {Object} R2ObjectInfo
 * @property {string} key
 * @property {number} size
 * @property {string} [uploaded] ISO timestamp
 */

/**
 * @typedef {Object} R2Store
 * @property {'binding'|'s3'} kind
 * @property {(key: string, body: Uint8Array|ArrayBuffer, contentType?: string) => Promise<void>} put
 * @property {(key: string) => Promise<void>} delete
 * @property {(prefix?: string, limit?: number) => Promise<R2ObjectInfo[]>} list
 * @property {(key: string) => Promise<R2ObjectInfo|null>} head
 */

/**
 * @typedef {Object} R2Credentials
 * @property {string} accountId
 * @property {string} accessKeyId
 * @property {string} secretAccessKey
 * @property {string} bucket
 */

const encoder = new TextEncoder();

/** @param {Uint8Array|ArrayBuffer|string} data */
async function sha256Hex(data) {
  const bytes = typeof data === 'string' ? encoder.encode(data) : toBytes(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return hex(digest);
}

/** @param {ArrayBuffer|Uint8Array} buffer */
function hex(buffer) {
  return [...toBytes(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** @param {Uint8Array|ArrayBuffer} data @returns {Uint8Array} */
function toBytes(data) {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/** @param {Uint8Array} key @param {string} message */
async function hmac(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
}

/**
 * AWS wants each path segment percent-encoded, but `/` left alone — and
 * encodeURIComponent leaves four characters AWS insists on encoding.
 * @param {string} segment
 */
function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/** @param {string} key */
function encodeKeyPath(key) {
  return key.split('/').map(encodeSegment).join('/');
}

/**
 * Sign and send one S3 request.
 * @param {R2Credentials} creds
 * @param {Object} options
 * @param {'GET'|'PUT'|'DELETE'|'HEAD'} options.method
 * @param {string} options.path  already-encoded, leading slash
 * @param {Record<string,string>} [options.query]
 * @param {Uint8Array} [options.body]
 * @param {string} [options.contentType]
 */
async function s3Fetch(creds, { method, path, query = {}, body, contentType }) {
  // `host` is a SIGNED header, so it has to be the host the request is actually
  // sent to — which is the endpoint's when one is set, not R2's. Signing the
  // R2 host while sending elsewhere produces a signature the receiver can never
  // reproduce.
  const endpoint = (
    creds.endpoint ?? `https://${creds.accountId}.r2.cloudflarestorage.com`
  ).replace(/\/+$/, '');
  const host = new URL(endpoint).host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(body ?? '');

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeSegment(k)}=${encodeSegment(query[k])}`)
    .join('&');

  // Only these three are signed. Content-Type travels unsigned, which S3
  // permits as long as it stays out of SignedHeaders.
  const canonicalHeaders =
    `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  let signingKey = await hmac(encoder.encode(`AWS4${creds.secretAccessKey}`), dateStamp);
  for (const part of ['auto', 's3', 'aws4_request']) signingKey = await hmac(signingKey, part);
  const signature = hex(await hmac(signingKey, stringToSign));

  /** @type {Record<string,string>} */
  const headers = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (contentType) headers['content-type'] = contentType;

  const url = `${endpoint}${path}${canonicalQuery ? `?${canonicalQuery}` : ''}`;
  const response = await fetch(url, {
    method,
    headers,
    body: body ? /** @type {BodyInit} */ (body) : undefined,
  });

  if (!response.ok && response.status !== 404) {
    const detail = await response.text().catch(() => '');
    throw new Error(`R2 ${method} ${path} failed: ${response.status} ${detail.slice(0, 300)}`);
  }
  return response;
}

/**
 * ListObjectsV2 returns XML and workerd has no parser. The response shape is
 * fixed and machine-generated, so three captures are enough — and a malformed
 * body yields an empty list rather than an exception.
 * @param {string} xml
 * @returns {R2ObjectInfo[]}
 */
function parseListXml(xml) {
  /** @type {R2ObjectInfo[]} */
  const items = [];
  const contents = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? [];
  for (const entry of contents) {
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(entry)?.[1];
    if (!key) continue;
    items.push({
      key: decodeXmlEntities(key),
      size: Number(/<Size>(\d+)<\/Size>/.exec(entry)?.[1] ?? 0),
      uploaded: /<LastModified>([\s\S]*?)<\/LastModified>/.exec(entry)?.[1],
    });
  }
  return items;
}

/** @param {string} value */
function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Store backed by the worker's R2 binding — no credentials, no signing.
 * @param {any} bucket the `MEDIA` binding
 * @returns {R2Store}
 */
export function bindingStore(bucket) {
  return {
    kind: 'binding',
    async put(key, body, contentType) {
      await bucket.put(key, body, {
        httpMetadata: contentType ? { contentType } : undefined,
      });
    },
    async delete(key) {
      await bucket.delete(key);
    },
    async list(prefix = '', limit = 1000) {
      const listed = await bucket.list({ prefix, limit });
      return listed.objects.map(
        /** @param {any} object */ (object) => ({
          key: object.key,
          size: object.size,
          uploaded: object.uploaded?.toISOString?.() ?? undefined,
        })
      );
    },
    async head(key) {
      const object = await bucket.head(key);
      return object
        ? { key, size: object.size, uploaded: object.uploaded?.toISOString?.() }
        : null;
    },
  };
}

/**
 * Store backed by R2's S3 API — used by `astro dev` and by the migration
 * script, both of which write to the SAME bucket the deployed worker uses.
 * @param {R2Credentials & {endpoint?: string}} creds
 * @returns {R2Store}
 */
export function s3Store(creds) {
  const bucketPath = `/${encodeSegment(creds.bucket)}`;
  return {
    kind: 's3',
    async put(key, body, contentType) {
      await s3Fetch(creds, {
        method: 'PUT',
        path: `${bucketPath}/${encodeKeyPath(key)}`,
        body: toBytes(body),
        contentType,
      });
    },
    async delete(key) {
      await s3Fetch(creds, { method: 'DELETE', path: `${bucketPath}/${encodeKeyPath(key)}` });
    },
    async list(prefix = '', limit = 1000) {
      // Paginated: S3 caps a page at 1000 keys regardless of what is asked for,
      // and a bucket holding a fleet's photographs passes that quickly. A
      // caller asking for orphans has to see ALL of them, so a silently
      // truncated first page would be worse than useless.
      /** @type {R2ObjectInfo[]} */
      const items = [];
      let token;
      do {
        /** @type {Record<string,string>} */
        const query = { 'list-type': '2', prefix, 'max-keys': String(Math.min(limit, 1000)) };
        if (token) query['continuation-token'] = token;

        const response = await s3Fetch(creds, { method: 'GET', path: bucketPath, query });
        const body = await response.text();
        items.push(...parseListXml(body));
        token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(body)?.[1];
      } while (token && items.length < limit);

      return items.slice(0, limit);
    },
    async head(key) {
      const response = await s3Fetch(creds, {
        method: 'HEAD',
        path: `${bucketPath}/${encodeKeyPath(key)}`,
      });
      if (response.status === 404) return null;
      return {
        key,
        size: Number(response.headers.get('content-length') ?? 0),
        uploaded: response.headers.get('last-modified') ?? undefined,
      };
    },
  };
}

/**
 * Pick a store from whatever the environment offers: the binding when the
 * worker has one, S3 credentials otherwise, and undefined when neither is
 * configured — callers turn that into a 503 with a readable message rather
 * than a stack trace.
 *
 * @param {Record<string, any>} env
 * @returns {R2Store|undefined}
 */
export function resolveStore(env) {
  if (env?.MEDIA && typeof env.MEDIA.put === 'function') return bindingStore(env.MEDIA);

  const accountId = env?.R2_ACCOUNT_ID;
  const accessKeyId = env?.R2_ACCESS_KEY_ID;
  const secretAccessKey = env?.R2_SECRET_ACCESS_KEY;
  const bucket = env?.R2_BUCKET;
  if (accountId && accessKeyId && secretAccessKey && bucket) {
    return s3Store({
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      endpoint: env?.R2_ENDPOINT,
    });
  }
  return undefined;
}
