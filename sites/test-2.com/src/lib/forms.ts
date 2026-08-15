import { getEntry } from 'astro:content';
import type { Props as FormProps } from '@astro-fleet/shared-ui/src/components/TreeQuoteForm.astro';
import site from '../content/settings/site.json';

/**
 * Turnstile site key, inlined at build time. It is public by design, so the
 * CMS-editable settings value is the source of truth — a build from CI has no
 * .env, and a form shipped without the key posts no token, which /api/quote
 * rejects the moment TURNSTILE_SECRET exists. PUBLIC_TURNSTILE_SITE_KEY still
 * overrides it locally, for testing against Cloudflare's dummy keys.
 */
const turnstileSiteKey =
  import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || site.business.technical.turnstileSiteKey || undefined;

/**
 * forms.ts
 * --------
 * Lookup for the `forms` content collection (src/content/forms/*.json), which
 * is where every form definition lives now that they are their own CMS model
 * rather than a branch of site settings.
 *
 * The id is the filename without its extension — `quote.json` → `getForm('quote')`.
 * The returned object is shaped for `<TreeQuoteForm />`, so a page can drop the
 * same form into as many sections as it likes.
 */
export async function getForm(id: string): Promise<FormProps> {
  const entry = await getEntry('forms', id);

  if (!entry) {
    throw new Error(
      `Form "${id}" not found. Expected sites/test-2.com/src/content/forms/${id}.json — ` +
        'check the Forms collection in the CMS.'
    );
  }

  // `name` is the CMS-facing label; everything else maps straight onto the
  // component's props.
  const { name: _label, ...form } = entry.data;
  return { ...form, turnstileSiteKey };
}
