/**
 * locations.ts
 * ------------
 * The whole Service Areas tree, derived from one CMS collection.
 *
 * Cities are the only entries an editor writes; the state and county levels are
 * grouped out of them, so /locations/, /locations/{state}/,
 * /locations/{state}/{county}/, the city page and every service×city page all
 * follow from the same source and can never disagree.
 *
 *   /locations/connecticut/fairfield-county/bridgeport/tree-removal/
 *    ^hub      ^stateSlug  ^countySlug      ^city slug ^service slug
 */
import { getCollection, type CollectionEntry } from 'astro:content';
import settings from '../content/settings/locations.json';
import site from '../content/settings/site.json';

export type LocationEntry = CollectionEntry<'locations'>;

export interface CityRef {
  slug: string;
  /** "Bridgeport" */
  name: string;
  /** "Bridgeport, CT" — the label used on cards and in the menu. */
  label: string;
  state: string;
  stateSlug: string;
  stateAbbr: string;
  county: string;
  countySlug: string;
  href: string;
}

export interface CountyRef {
  name: string;
  slug: string;
  state: string;
  stateSlug: string;
  stateAbbr: string;
  href: string;
  cities: CityRef[];
}

export interface StateRef {
  name: string;
  slug: string;
  abbr: string;
  href: string;
  counties: CountyRef[];
  cities: CityRef[];
}

export const LOCATIONS_ROOT = '/locations/';

export const cityHref = (stateSlug: string, countySlug: string, slug: string) =>
  `${LOCATIONS_ROOT}${stateSlug}/${countySlug}/${slug}/`;

export const cityServiceHref = (city: CityRef, serviceSlug: string) =>
  `${city.href}${serviceSlug}/`;

/** `bridgeport.md` → `bridgeport`. */
const entrySlug = (entry: LocationEntry) => entry.id.replace(/\.md$/, '');

const toCityRef = (entry: LocationEntry): CityRef => {
  const d = entry.data;
  const slug = entrySlug(entry);
  return {
    slug,
    name: d.title,
    label: `${d.title}, ${d.stateAbbr}`,
    state: d.state,
    stateSlug: d.stateSlug,
    stateAbbr: d.stateAbbr,
    county: d.county,
    countySlug: d.countySlug,
    href: cityHref(d.stateSlug, d.countySlug, slug),
  };
};

/** Published cities, in CMS order. */
export async function getCities(): Promise<CityRef[]> {
  const entries = await getCollection('locations', ({ data }) => !data.draft);
  return entries
    .sort((a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title))
    .map(toCityRef);
}

/** The full tree: states → counties → cities. */
export async function getLocationTree(): Promise<StateRef[]> {
  const cities = await getCities();
  const states = new Map<string, StateRef>();

  for (const city of cities) {
    let state = states.get(city.stateSlug);
    if (!state) {
      state = {
        name: city.state,
        slug: city.stateSlug,
        abbr: city.stateAbbr,
        href: `${LOCATIONS_ROOT}${city.stateSlug}/`,
        counties: [],
        cities: [],
      };
      states.set(city.stateSlug, state);
    }
    state.cities.push(city);

    let county = state.counties.find((c) => c.slug === city.countySlug);
    if (!county) {
      county = {
        name: city.county,
        slug: city.countySlug,
        state: city.state,
        stateSlug: city.stateSlug,
        stateAbbr: city.stateAbbr,
        href: `${LOCATIONS_ROOT}${city.stateSlug}/${city.countySlug}/`,
        cities: [],
      };
      state.counties.push(county);
    }
    county.cities.push(city);
  }

  return [...states.values()];
}

export interface CityService {
  slug: string;
  title: string;
  /** The card as it appears in any services grid. */
  card: { description: string; image: string; icon: string };
  /** "Tree Removal in Bridgeport" — used by the menu and page titles. */
  label: (city: CityRef) => string;
}

/**
 * The services offered in every town (Service Areas Settings → Services). One
 * list drives the hub cards, the third level of the menu and which service×city
 * pages are built, so the three can never fall out of step.
 */
export async function getAreaServices(): Promise<CityService[]> {
  const entries = await getCollection('services', ({ data }) => !data.draft);
  const bySlug = new Map(entries.map((entry) => [entry.id.replace(/\.md$/, ''), entry]));

  return (settings.services as string[])
    .map((slug) => {
      const entry = bySlug.get(slug);
      if (!entry) return null;
      return {
        slug,
        title: entry.data.title,
        card: entry.data.card,
        label: (city: CityRef) => `${entry.data.title} in ${city.name}`,
      } satisfies CityService;
    })
    .filter((service): service is CityService => service !== null);
}

/** Cards for TreeLocationsHub — a town per card, its services beneath. */
export function toHubCards(cities: CityRef[], services: CityService[]) {
  return cities.map((city) => ({
    title: city.label,
    href: city.href,
    services: services.map((service) => ({
      label: service.title,
      href: cityServiceHref(city, service.slug),
    })),
  }));
}

/**
 * The services grid on a city page — same cards as anywhere else on the site,
 * pointed at that town's service pages rather than the site-wide ones.
 */
export function toCityServiceCards(city: CityRef, services: CityService[]) {
  return services.map((service) => ({
    title: service.title,
    description: service.card.description,
    image: service.card.image,
    icon: service.card.icon,
    href: cityServiceHref(city, service.slug),
  }));
}

/**
 * {city} {state} {stateAbbr} {county} {name} {phone} — the tokens the Service
 * Areas copy is written with. Same idea as the SEO title patterns, applied to
 * on-page copy so one heading serves every town.
 */
export function fillTokens(
  template: string | undefined,
  tokens: Record<string, string | undefined> = {}
): string {
  if (!template) return '';
  const all: Record<string, string | undefined> = {
    name: site.siteName,
    phone: site.business.contact.phone,
    ...tokens,
  };
  return template
    .replace(/\{(\w+)\}/g, (_match, key: string) => all[key] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const areaSettings = settings;
