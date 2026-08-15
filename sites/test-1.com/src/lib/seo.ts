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
import { siteSettings } from './runtime-content';
// Kept for its TYPE only — `SeoPattern` has to stay a union of the real pattern
// keys, which a value read at runtime cannot give us.
import siteShape from '../content/settings/site.json';

type TokenValue = string | number | null | undefined;
export type SeoPattern = keyof typeof siteShape.seo.patterns;

// Read per call rather than destructured once at import: middleware refreshes
// the settings holder on every request, so binding these at module load would
// pin the build-time copy for the whole life of the worker — which is exactly
// the staleness this site exists to avoid.
const limitsOf = () => siteSettings().seo.limits;

interface SeoOverride {
  path: string;
  title?: string;
  description?: string;
}
// An empty overrides list types as never[], so state the shape the CMS writes.
const overridesOf = () => siteSettings().seo.overrides as SeoOverride[];

/** Tokens available to every pattern. */
const baseTokens = (): Record<string, TokenValue> => {
  const site = siteSettings();
  const business = site.business;
  return {
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
  const limits = limitsOf();
  if (title.length > limits.titleMax) {
    console.warn(
      `[seo] Title is ${title.length} chars (limit ${limits.titleMax})${path ? ` on ${path}` : ''}: "${title}"`
    );
  }
  return title;
};

/** Descriptions are prose, so trimming at a word boundary is safe. */
const clampDescription = (description: string) => {
  const limits = limitsOf();
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
    ? overridesOf().find((entry) => normalizePath(entry.path) === normalizePath(path))
    : undefined;

  const template = pattern ? siteSettings().seo.patterns[pattern] : '';
  const fromPattern = template ? fill(template, { ...baseTokens(), ...tokens }) : '';

  return {
    title: checkTitle(override?.title || fromPattern || title, path),
    description: clampDescription(override?.description || description),
  };
}
