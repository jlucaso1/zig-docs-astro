import { defineCollection, z } from 'astro:content';

export const collections = {
  docs: defineCollection({
    schema: z.object({
      title: z.string(),
      category: z.number(),
      index: z.number(),
      path: z.string().optional(),
    }),
  }),
};