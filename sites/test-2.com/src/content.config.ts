import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { array, boolean, coerce, enum as enum_, object, string } from 'astro/zod';

// Reads the markdown files Sveltia writes to src/content/posts/.
// Keep this schema in sync with the `fields` in public/admin/config.yml.
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: object({
    title: string(),
    date: coerce.date(),
    description: string().optional(),
    image: string().optional(),
    imageAlt: string().optional(),
    draft: boolean().default(false),
  }),
});

// Forms are a content model of their own, not a corner of site settings: one
// JSON file per form, reusable from any page. The entry id is the filename
// (`quote.json` → `quote`), which is what `getForm()` in src/lib/forms.ts looks
// up. Keep this schema in sync with the `forms` collection in
// public/admin/config.yml.
const forms = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/forms' }),
  schema: object({
    /** Human label for the CMS list — not rendered on the page. */
    name: string(),
    title: string(),
    subtitle: string().optional(),
    submitText: string(),
    /** Endpoint the form posts to (a Cloudflare Pages Function). */
    action: string(),
    fields: array(
      object({
        name: string(),
        type: enum_(['text', 'email', 'tel', 'textarea', 'select', 'radio']),
        label: string().optional(),
        placeholder: string().optional(),
        required: boolean().default(false),
        /** select / radio only. */
        options: array(string()).optional(),
      })
    ),
  }),
});

export const collections = { posts, forms };
