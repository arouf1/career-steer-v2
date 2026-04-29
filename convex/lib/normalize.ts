export const normalizeTitle = (title: string): string =>
  title.toLowerCase().replace(/\s+/g, " ").trim();

export const slugify = (title: string): string =>
  title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
