// Keystatic's server API — reads and writes content in local mode, and handles
// the GitHub App OAuth handshake plus commits in github mode.
import type { APIContext, APIRoute } from 'astro';
import { makeHandler } from '@keystatic/astro/api';
import { env } from 'cloudflare:workers';
import config from '../../../../keystatic.config';

export const prerender = false;

const handler = makeHandler({ config });

/**
 * @keystatic/astro reads its GitHub App credentials from
 * `context.locals.runtime.env`. Astro 6's Cloudflare adapter replaced that with
 * a getter that throws and points at `cloudflare:workers` instead, so calling
 * the handler with the real context is an instant 500.
 *
 * The handler only ever touches `request`, `cookies` and `locals`, so it gets a
 * minimal context with `runtime.env` filled from the supported import. If a
 * future @keystatic/astro reaches for anything else on the context, it will
 * show up here as an undefined property rather than silently.
 */
export const ALL: APIRoute = (context: APIContext) =>
  handler({
    request: context.request,
    cookies: context.cookies,
    locals: { runtime: { env } },
  } as unknown as APIContext);
