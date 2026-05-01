import type { MetadataRoute } from "next";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export const revalidate = 600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const guides = await fetchQuery(api.careerGuides.listAll, {});
  return guides.map((g) => ({
    url: `/career-guides/${g.slug}`,
    lastModified: new Date(g.updatedAt),
    changeFrequency: "monthly",
    priority: 0.7,
  }));
}
