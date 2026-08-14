import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { array, boolean, coerce, enum as enum_, number, object, string } from 'astro/zod';

// Reads the markdown files Keystatic writes to src/content/posts/.
// Keep this schema in sync with the `posts` collection in keystatic.config.ts.
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
// keystatic.config.ts.
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
// keystatic.config.ts.
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
      title: string().optional(),
      description: string().optional(),
      keywords: array(string()).optional(),
    }).optional(),

    // The optional sections below can arrive in two shapes: absent entirely (a
    // service authored before the CMS ever touched it) or present-but-blank
    // (Keystatic always writes an object for every field group, and drops keys
    // whose value is empty — a service saved with no hero arrives as
    // `hero: {}`). The detail page treats both as "no section", so EVERY field
    // inside has to be optional; requiring one turns a blank block into a build
    // failure the editor has no way to interpret.

    /** Dark page hero at the top of the detail page. Rendered only if `image` is set. */
    hero: object({
      title: string().optional(),
      description: string().optional(),
      image: string().optional(),
      imageAlt: string().optional(),
      imageSplit: string().optional(),
    }).optional(),

    /** "Safe, Professional Tree Removal…" — heading + prose + CTA + photo. */
    intro: object({
      heading: string().optional(),
      paragraphs: array(string()).default([]),
      ctaLabel: string().optional(),
      ctaHref: string().optional(),
      image: string().optional(),
      imageAlt: string().optional(),
    }).optional(),

    /** Service-specific heading for the shared Why Choose Us block. */
    whyChooseHeading: string().optional(),

    /** "WHAT WE CAN DO FOR YOU" — bullets on the left, icon chips on the right. */
    capabilities: object({
      heading: string().optional(),
      intro: string().optional(),
      bullets: array(string()).default([]),
      ctaLabel: string().optional(),
      ctaHref: string().optional(),
      chips: array(object({ icon: string(), label: string() })).default([]),
    }).optional(),

    /** "When Does a Tree… Need to Be Removed?" — intro + two columns of ticks. */
    checklist: object({
      heading: string().optional(),
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

// Service Areas — one markdown file per CITY, the only level of the locations
// tree that carries real content. The state and county pages above it are
// generated by grouping these entries (see src/lib/locations.ts), so adding a
// town is a single CMS entry and every URL level, menu column and hub card
// follows.
//
// URLs: /locations/{stateSlug}/{countySlug}/{slug}/ and, per service,
// /locations/{stateSlug}/{countySlug}/{slug}/{service}/.
// Keep in sync with the `locations` collection in keystatic.config.ts.
const locations = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/locations' }),
  schema: object({
    /** City name as written in copy, e.g. "Bridgeport". */
    title: string(),
    /** Postal abbreviation shown on cards and in titles — "CT". */
    stateAbbr: string(),
    state: string(),
    stateSlug: string(),
    county: string(),
    countySlug: string(),
    order: number().default(0),
    draft: boolean().default(false),

    seo: object({
      title: string().optional(),
      description: string().optional(),
      keywords: array(string()).optional(),
    }).optional(),

    /** Dark hero band at the top of the city page. */
    hero: object({
      title: string().optional(),
      description: string().optional(),
      image: string().optional(),
      imageAlt: string().optional(),
      imageSplit: string().optional(),
    }).optional(),

    /** "Why <City> homeowners trust us" — photo left, copy right. */
    intro: object({
      heading: string().optional(),
      paragraphs: array(string()).default([]),
      ctaLabel: string().optional(),
      ctaHref: string().optional(),
      image: string().optional(),
      imageAlt: string().optional(),
    }).optional(),

    /** Heading above the services grid. */
    servicesHeading: string().optional(),

    /** "Common tree problems in <City>" — the shared core-values card row. */
    problems: object({
      eyebrow: string().optional(),
      heading: string().optional(),
      items: array(object({ icon: string(), title: string(), description: string() })).default([]),
    }).optional(),

    /** Permit + pricing long-form block; the prose is this file's markdown body. */
    permit: object({
      image: string().optional(),
      imageAlt: string().optional(),
      ctaLabel: string().optional(),
      ctaHref: string().optional(),
    }).optional(),

    /** Per-city FAQ. Falls back to the homepage FAQ when empty. */
    faq: object({
      eyebrow: string().optional(),
      titleLead: string().optional(),
      titleRest: string().optional(),
      subtitle: string().optional(),
      items: array(object({ question: string(), answer: string() })).default([]),
    }).optional(),
  }),
});

export const collections = { posts, forms, services, locations };
