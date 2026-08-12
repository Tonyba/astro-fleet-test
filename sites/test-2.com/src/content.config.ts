import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { array, boolean, coerce, enum as enum_, number, object, string } from 'astro/zod';

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

// Single Service — the source of truth for every service on the site.
// One markdown file per service; the FILENAME is the slug the detail page is
// built at (`tree-removal.md` → /service/tree-removal/). Every services grid
// (homepage, /services/commercial/, /services/residential/) reads this
// collection rather than carrying its own copy of the cards.
//
// `categories` is the residential/commercial taxonomy — a service may sit in
// both (the six tree-care services do). `group` splits the two grids that the
// residential page stacks. Keep in sync with the `services` collection in
// public/admin/config.yml.
const services = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/services' }),
  schema: object({
    title: string(),
    /** Ascending sort within a grid. */
    order: number().default(0),
    categories: array(enum_(['residential', 'commercial'])).default(['residential']),
    group: enum_(['tree-care', 'outdoor-solutions']).default('tree-care'),
    draft: boolean().default(false),

    /** The card as it appears in every services grid. */
    card: object({
      description: string(),
      image: string(),
      icon: string(),
    }),

    seo: object({
      title: string(),
      description: string(),
      keywords: array(string()).optional(),
    }).optional(),

    /** Dark page hero at the top of the detail page. */
    hero: object({
      title: string(),
      description: string().optional(),
      image: string(),
      imageAlt: string(),
      imageSplit: string().optional(),
    }).optional(),

    /** "Safe, Professional Tree Removal…" — heading + prose + CTA + photo. */
    intro: object({
      heading: string(),
      paragraphs: array(string()),
      ctaLabel: string().optional(),
      ctaHref: string().optional(),
      image: string(),
      imageAlt: string(),
    }).optional(),

    /** Service-specific heading for the shared Why Choose Us block. */
    whyChooseHeading: string().optional(),

    /** "WHAT WE CAN DO FOR YOU" — bullets on the left, icon chips on the right. */
    capabilities: object({
      heading: string(),
      intro: string().optional(),
      bullets: array(string()).default([]),
      ctaLabel: string().optional(),
      ctaHref: string().optional(),
      chips: array(object({ icon: string(), label: string() })).default([]),
    }).optional(),

    /** "When Does a Tree… Need to Be Removed?" — intro + two columns of ticks. */
    checklist: object({
      heading: string(),
      intro: string().optional(),
      items: array(string()).default([]),
    }).optional(),

    /** Photo shown beside the long-form markdown body. */
    bodyImage: string().optional(),
    bodyImageAlt: string().optional(),
    bodyCtaLabel: string().optional(),
    bodyCtaHref: string().optional(),
  }),
});

export const collections = { posts, forms, services };
