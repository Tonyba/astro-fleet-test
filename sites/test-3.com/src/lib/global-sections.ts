/**
 * global-sections.ts
 * ------------------
 * The seven sections edited under "Global Sections" in the CMS: the trust bar,
 * testimonials, service areas, FAQ, inspection form, emergency banner and the
 * projects carousel.
 *
 * Each is a singleton of its own, so the homepage, the service pages, the about
 * page and every location page all render the SAME entry — that is what makes
 * them global. Editing one in Keystatic changes it everywhere it appears; there
 * is no per-page copy left to fall out of sync.
 *
 * Pages read them through this one object rather than importing seven files
 * each: `globals.faq.items`, `globals.trustBar.slogan`, and so on.
 */
import trustBar from '../content/global/trust-bar.json';
import testimonials from '../content/global/testimonials.json';
import serviceAreas from '../content/global/service-areas.json';
import faq from '../content/global/faq.json';
import inspection from '../content/global/inspection.json';
import emergency from '../content/global/emergency.json';
import projects from '../content/global/projects.json';

export const globals = {
  trustBar,
  testimonials,
  serviceAreas,
  faq,
  inspection,
  emergency,
  projects,
};

export type GlobalSections = typeof globals;
