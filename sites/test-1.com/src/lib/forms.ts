import { getDocFull } from './runtime-content';
import type { Props as FormProps } from '@astro-fleet/shared-ui/src/components/TreeQuoteForm.astro';

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
  const entry = await getDocFull('forms/' + id);

  if (!entry) {
    throw new Error(
      `Form "${id}" not found. Expected sites/test-1.com/src/content/forms/${id}.json — ` +
        'check the Forms collection in the CMS.'
    );
  }

  // `name` is the CMS-facing label; everything else maps straight onto the
  // component's props.
  //
  // `formId` is added rather than read: it travels with the submission as a
  // hidden input so /api/quote can reload THIS definition and learn what the
  // fields currently are. Without it the endpoint would be back to a hardcoded
  // field list, and every field an editor adds in the CMS would be dropped on
  // submit.
  const { name: _label, ...form } = entry.data;
  return { ...form, formId: id };
}
