import type { MetadataRoute } from "next";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

// Revalidate hourly. Job postings churn faster than career guides; an hour
// is short enough that newly-cached jobs make it into Google's index quickly,
// long enough that we're not regenerating the XML on every crawler hit.
export const revalidate = 3600;

const PAGE_SIZE = 5000; // Google's per-sitemap limit; we'll need an index later if we exceed.

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Reads from job_postings_index — the lightweight mirror — so this query
  // doesn't pay the byte cost of carrying rawDescription / content / future
  // embeddings on each row.
  const { items } = await fetchQuery(api.jobPostings.listPublicRecent, {
    limit: PAGE_SIZE,
  });

  return items.map((item) => ({
    url: `/jobs/listing/${item.citySlug}/${item.companySlug}/${item.titleSlug}/${item.jobPostingId}`,
    lastModified: new Date(item.lastSeenAt),
    // Postings turn over within a few weeks; "weekly" is a fair signal to
    // crawlers without overstating freshness.
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));
}
