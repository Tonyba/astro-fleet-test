import { getEntry } from 'astro:content';
import type { Props as FormProps } from '@astro-fleet/shared-ui/src/components/TreeQuoteForm.astro';
import site from '../content/settings/site.json';

/**
 * Turnstile site key, inlined at build time. It is public by design, so the
 * CMS-editable settings value is the source of truth — a build from CI has no
 * .env, and a form shipped without the key posts no token, which CloudCannon
 * rejects once "Require CAPTCHA" is on for the inbox. PUBLIC_TURNSTILE_SITE_KEY
 * still overrides it locally, for testing against Cloudflare's dummy keys.
 */
const turnstileSiteKey =
  import.meta.env.PUBLIC_TURNSTILE_SITE_KEY || site.business.technical.turnstileSiteKey || undefined;

/**
 * CloudCannon Inbox key, from the same settings file.
 *
 * Its presence is what switches every form on this site to a native post:
 * CloudCannon's hosting intercepts the POST, stores the submission against this
 * inbox, forwards it to the inbox's targets, and answers 303 to the form's
 * `action` — which is why `action` is a success page here and not an endpoint.
 *
 * Leave it blank in the CMS and the forms fall back to posting JSON to
 * `action`, which is what a site with its own endpoint wants.
 */
const inboxKey = site.business.technical.cloudcannonInboxKey || undefined;

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
      `Form "${id}" not found. Expected sites/test-3.com/src/content/forms/${id}.json — ` +
        'check the Forms collection in the CMS.'
    );
  }

  // `name` is the CMS-facing label; everything else maps straight onto the
  // component's props.
  const { name: _label, ...form } = entry.data;
  return { ...form, turnstileSiteKey, inboxKey };
}
