/**
 * POST /api/leads/delete — permanently remove one lead.
 *
 * D1 is the only store, so this is irreversible; /admin/leads asks for
 * confirmation on its own page before posting here.
 */
import type { APIRoute } from 'astro';
import { isSignedIn } from '../../../lib/leads-auth';
import { deleteLead } from '../../../lib/leads';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!(await isSignedIn(request))) {
    return new Response(null, { status: 303, headers: { location: '/admin/leads' } });
  }

  let id = '';
  try {
    id = String((await request.formData()).get('id') ?? '').trim();
  } catch {
    // An unreadable body deletes nothing.
  }
  if (!id) return new Response(null, { status: 303, headers: { location: '/admin/leads' } });

  const removed = await deleteLead(id);
  // Worth a log line: this is the one action here that destroys data.
  console.log(`leads: delete ${id} — ${removed ? 'removed' : 'not found'}`);

  return new Response(null, { status: 303, headers: { location: '/admin/leads' } });
};
