/**
 * GET /api/leads/export.csv — download the leads matching a search (or all).
 */
import type { APIRoute } from 'astro';
import { isSignedIn } from '../../../lib/leads-auth';
import { allLeads, toCsv } from '../../../lib/leads';

export const prerender = false;

export const GET: APIRoute = async ({ request, url }) => {
  if (!(await isSignedIn(request))) {
    return new Response(null, { status: 303, headers: { location: '/admin/leads' } });
  }

  const search = url.searchParams.get('q') ?? '';
  const csv = toCsv(await allLeads(search));
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="leads-${stamp}.csv"`,
      // Customer data: no shared cache may keep a copy.
      'cache-control': 'no-store, private',
    },
  });
};
