/**
 * POST /api/leads/login — exchange the shared password for a session cookie.
 */
import type { APIRoute } from 'astro';
import { checkPassword, issueSession } from '../../../lib/leads-auth';

export const prerender = false;

/**
 * A deliberate pause on every failure. One shared password is one guessable
 * secret, and this endpoint is the whole door; a second per attempt turns an
 * online brute force into something that takes years without inconveniencing
 * anyone who knows the password.
 */
const FAILURE_DELAY_MS = 1_000;

export const POST: APIRoute = async ({ request }) => {
  let submitted = '';
  try {
    submitted = String((await request.formData()).get('password') ?? '');
  } catch {
    // Fall through to the failure path — an unreadable body is a failed attempt.
  }

  if (!(await checkPassword(submitted))) {
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    return new Response(null, { status: 303, headers: { location: '/admin/leads?failed' } });
  }

  return new Response(null, {
    status: 303,
    headers: { location: '/admin/leads', 'set-cookie': await issueSession() },
  });
};
