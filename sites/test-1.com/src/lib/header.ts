/**
 * header.ts
 * ---------
 * Builds the header every page renders.
 *
 * The navigation itself is edited in Header & Footer → Header, with one
 * exception: the item pointing at /locations/ gets its submenu generated from
 * the Service Areas content — towns on the second level, that town's services
 * on the third. Adding a town in the CMS therefore updates the menu on every
 * page, and the item's label and position stay editable like any other.
 */
import { chromeSettings, type ChromeSettings } from './runtime-content';
import { LOCATIONS_ROOT, cityServiceHref, getAreaServices, getCities } from './locations';

type Nav = ChromeSettings['header']['navigation'];

export async function getHeader() {
  const chrome = chromeSettings();
  const isAreasItem = (href: string) => href.replace(/\/+$/, '/') === LOCATIONS_ROOT;
  if (!chrome.header.navigation.some((item) => isAreasItem(item.href))) return chrome.header;

  const [cities, services] = await Promise.all([getCities(), getAreaServices()]);

  const navigation = chrome.header.navigation.map((item) => {
    if (!isAreasItem(item.href)) return item;
    return {
      ...item,
      caret: true,
      submenu: cities.map((city) => ({
        label: city.label,
        href: city.href,
        submenu: services.map((service) => ({
          label: service.label(city),
          href: cityServiceHref(city, service.slug),
        })),
      })),
    };
  }) as unknown as Nav;

  return { ...chrome.header, navigation };
}
