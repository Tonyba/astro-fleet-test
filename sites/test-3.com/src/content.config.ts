import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { array, boolean, coerce, object, string } from 'astro/zod';

// Reads the markdown files CloudCannon writes to src/content/posts/.
// Keep this schema in sync with .cloudcannon/schemas/test-3-post.md.
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: object({
    title: string(),
    date: coerce.date(),
    description: string().optional(),
    draft: boolean().default(false),
  }),
});

// A link with a label — header CTAs, card links, buttons.
const cta = object({
  text: string().default(''),
  href: string().default(''),
});

// A ServiceCard: used by the home page's feature grid and the services grid.
const card = object({
  title: string().default(''),
  description: string().default(''),
  href: string().default(''),
  link_text: string().default('Learn More'),
});

/**
 * Page copy for the hand-built routes in src/pages/.
 *
 * One markdown file per route, matched by id: home.md -> /, about.md -> /about/
 * and so on. Every route keeps its own .astro file and styles; only the text,
 * links and repeatable items come from here so CloudCannon can edit them.
 *
 * The schema is a superset of what any single page uses, so every block is
 * defaulted and every field inside a block is optional. A page only carries the
 * keys it needs, and CloudCannon renders inputs from the keys in the file.
 */
const pages = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/pages' }),
  schema: object({
    // SEO
    title: string(),
    description: string().default(''),
    keywords: array(string()).default([]),
    /** Output URL — CloudCannon maps the entry to its live page with this. */
    permalink: string().default('/'),

    breadcrumb: array(
      object({
        label: string().default(''),
        href: string().optional(),
      }),
    ).default([]),

    hero: object({
      eyebrow: string().default(''),
      badge: string().default(''),
      title: string().default(''),
      headline: string().default(''),
      headline_accent: string().default(''),
      subtitle: string().default(''),
      primary_cta: cta.default({}),
      secondary_cta: cta.default({}),
    }).default({}),

    // Home
    trust_items: array(object({ text: string().default('') })).default([]),
    features_heading: string().default(''),
    features_description: string().default(''),
    features: array(card).default([]),

    // Services
    services: array(card).default([]),

    // About
    team: object({
      heading: string().default(''),
      note: string().default(''),
      members: array(
        object({
          name: string().default(''),
          role: string().default(''),
        }),
      ).default([]),
    }).default({}),

    // Contact
    form: object({
      action: string().default('#'),
      heading: string().default(''),
      description: string().default(''),
    }).default({}),

    // Blog index
    empty_state: string().default(''),

    // 404
    back_link: cta.default({}),

    // Shared closing CTA band
    cta: object({
      heading: string().default(''),
      description: string().default(''),
      primary_button: cta.default({}),
      secondary_button: cta.default({}),
      /** 'dark' (default) or 'light' */
      variant: string().default('dark'),
    }).default({}),
  }),
});

export const collections = { posts, pages };
