/**
 * POST /api/leads/logout — drop the session cookie.
 */
import type { APIRoute } from 'astro';
import { clearSession } from '../../../lib/leads-auth';

export const prerender = false;

export const POST: APIRoute = async () =>
  new Response(null, {
    status: 303,
    headers: { location: '/admin/leads', 'set-cookie': clearSession() },
  });
