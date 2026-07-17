import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    section: z.enum(['start', 'concepts', 'guides']),
    order: z.number(),
    deeper: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
  }),
});

export const collections = { docs };
