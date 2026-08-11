import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { boolean, coerce, object, string } from 'astro/zod';

// Reads the markdown files Sveltia writes to src/content/posts/.
// Keep this schema in sync with the `fields` in public/admin/config.yml.
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: object({
    title: string(),
    date: coerce.date(),
    description: string().optional(),
    draft: boolean().default(false),
  }),
});

export const collections = { posts };
