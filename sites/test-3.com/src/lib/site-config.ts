/**
 * site-config.ts
 * ---------------
 * Central configuration for the Test-3 site.
 *
 * The VALUES no longer live here — they live in `src/data/site.json`, which is
 * what CloudCannon edits (see the `site` collection in the repo-root
 * cloudcannon.config.yml). This file is the typed adapter between that JSON and
 * the shared-ui component props, so every page keeps importing the same names.
 *
 * Change site identity, navigation, footer, contact details or social links in
 * the CMS — or by editing site.json directly. Do not hardcode them here again.
 */

import type { MenuItem } from '@astro-fleet/shared-ui/src/components/Header.astro';
import type {
  FooterColumn,
  ContactInfo,
  SocialLink,
} from '@astro-fleet/shared-ui/src/components/Footer.astro';
import site from '../data/site.json';

// ---------------------------------------------------------------------------
// Site identity
// ---------------------------------------------------------------------------

/** The human-readable name of your site, used in the <title>, header, and footer. */
export const SITE_NAME: string = site.site_name;

/** A short tagline displayed in the footer beneath the site name. */
export const TAGLINE: string = site.tagline;

/** Path to the logo image rendered in the header. Blank falls back to a text logo. */
export const LOGO_SRC: string | undefined = site.logo || undefined;

/** Alt text for the header logo. */
export const LOGO_ALT: string = site.logo_alt;

// ---------------------------------------------------------------------------
// Header CTA
// ---------------------------------------------------------------------------

/** Label of the button at the right-hand end of the header. */
export const CTA_TEXT: string = site.header_cta.text;

/** Where that button points. */
export const CTA_HREF: string = site.header_cta.href;

// ---------------------------------------------------------------------------
// Navigation, footer, contact, social
// ---------------------------------------------------------------------------

/** Top-level header navigation. Items may carry a `children` array for dropdowns. */
export const navigation: MenuItem[] = site.navigation;

/** Link columns rendered in the footer grid. */
export const footerColumns: FooterColumn[] = site.footer_columns;

/** Contact details rendered in the footer's contact section. */
export const contactInfo: ContactInfo = site.contact;

/** Social media links rendered as icon buttons in the footer. */
export const socialLinks: SocialLink[] = site.social;
