/**
 * seo.ts
 * ------
 * Builds every page title from the patterns in Site Settings → SEO, so the
 * whole site restates the brand, the primary city and the state the same way
 * and a rebrand is one CMS edit rather than nineteen.
 *
 * Precedence:  per-URL override  >  pattern for the page type  >  the page's
 * own SEO title. The overrides list exists precisely so a page can opt out.
 *
 * Business facts come from Site Settings → Business (the ported business.json);
 * nothing here restates a fact of its own.
 */
import site from '../content/settings/site.json';

type TokenValue = string | number | null | undefined;
export type SeoPattern = keyof typeof site.seo.patterns;

const { patterns, limits } = site.seo;
const business = site.business;

interface SeoOverride {
  path: string;
  title?: string;
  description?: string;
}
// An empty overrides list types as never[], so state the shape the CMS writes.
const overrides = site.seo.overrides as SeoOverride[];

/** Tokens available to every pattern. */
const BASE_TOKENS: Record<string, TokenValue> = {
  name: site.siteName,
  legalName: business.identity.legalName,
  tagline: business.identity.tagline,
  primaryCity: business.serviceArea.primaryCity,
  city: business.address.city,
  state: business.address.state,
  county: business.address.county,
  phone: business.contact.phone,
  email: business.contact.email,
};

/** `/services/residential` and `services/residential/` are the same page. */
const normalizePath = (path: string) => `/${path.replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');

/**
 * A token with no value must not leave the separator that framed it behind —
 * "Contact Erick's Tree Service | " is worse than a short title.
 */
const tidy = (title: string) =>
  title
    .replace(/\s+/g, ' ')
    .replace(/\s*([|—–-])\s*(?=[|—–-])/g, '')
    .replace(/,\s*(?=[|—–-]|$)/g, '')
    .replace(/^[\s|—–,-]+|[\s|—–,-]+$/g, '')
    .trim();

const fill = (pattern: string, tokens: Record<string, TokenValue>) =>
  tidy(
    pattern.replace(/\{(\w+)\}/g, (_match, key: string) => {
      const value = tokens[key];
      return value === null || value === undefined ? '' : String(value);
    })
  );

/**
 * Titles are never cut: the brand sits at the END of every pattern, so
 * truncating would drop it — and SEOHead would then append the site name
 * again, making the title longer than it started. Report and move on; the fix
 * is shorter copy in the CMS, not a mangled tag.
 */
const checkTitle = (title: string, path?: string) => {
  if (title.length > limits.titleMax) {
    console.warn(
      `[seo] Title is ${title.length} chars (limit ${limits.titleMax})${path ? ` on ${path}` : ''}: "${title}"`
    );
  }
  return title;
};

/** Descriptions are prose, so trimming at a word boundary is safe. */
const clampDescription = (description: string) => {
  if (description.length <= limits.descriptionMax) return description;
  const cut = description.slice(0, limits.descriptionMax - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limits.descriptionMax * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
};

export interface SeoInput {
  /** Which title pattern to apply. Omit for pages that have no pattern. */
  pattern?: SeoPattern;
  /** Page-specific tokens — {service} on a service page, {title} on a post. */
  tokens?: Record<string, TokenValue>;
  /** The page's own CMS title. Used when the pattern is blank. */
  title: string;
  /** The page's own CMS description. */
  description: string;
  /** Astro.url.pathname — matches an entry in the CMS overrides list. */
  path?: string;
}

export function resolveSeo({ pattern, tokens = {}, title, description, path }: SeoInput) {
  const override = path
    ? overrides.find((entry) => normalizePath(entry.path) === normalizePath(path))
    : undefined;

  const template = pattern ? patterns[pattern] : '';
  const fromPattern = template ? fill(template, { ...BASE_TOKENS, ...tokens }) : '';

  return {
    title: checkTitle(override?.title || fromPattern || title, path),
    description: clampDescription(override?.description || description),
  };
}
