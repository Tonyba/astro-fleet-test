import { getCollection } from 'astro:content';

export type ServiceCategory = 'residential' | 'commercial';
export type ServiceGroup = 'tree-care' | 'outdoor-solutions';

export interface ServiceCard {
  title: string;
  description: string;
  image: string;
  icon: string;
  href: string;
}

interface Filter {
  /** Only services carrying this taxonomy term. Omit for all. */
  category?: ServiceCategory;
  /** Which of the two grids the service belongs to. Omit for all. */
  group?: ServiceGroup;
}

/**
 * The single source of truth for every services grid on the site.
 *
 * Reads the `services` collection (one markdown file per service, authored in
 * Sveltia under "Single Service") and shapes each entry into the card contract
 * TreeServices expects. `href` is derived from the filename, so a card and its
 * detail page can never drift apart.
 */
export async function getServiceCards({ category, group }: Filter = {}): Promise<ServiceCard[]> {
  const entries = await getCollection('services', ({ data }) => !data.draft);

  return entries
    .filter((entry) => !category || entry.data.categories.includes(category))
    .filter((entry) => !group || entry.data.group === group)
    .sort((a, b) => a.data.order - b.data.order || a.data.title.localeCompare(b.data.title))
    .map((entry) => ({
      title: entry.data.title,
      description: entry.data.card.description,
      image: entry.data.card.image,
      icon: entry.data.card.icon,
      href: `/service/${entry.id.replace(/\.md$/, '')}/`,
    }));
}
