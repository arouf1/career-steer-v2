// Thin wrapper around Brandfetch's Brand Search API.
// Docs: https://docs.brandfetch.com/reference/search
//
// We use:
//   GET https://api.brandfetch.io/v2/search/{query}?c={clientId}
//
// Returns an array of `{ name, domain, icon, brandId, claimed }`. The first
// "claimed" hit is usually the right company; we fall back to the first hit
// otherwise. Brand Search is free with a client ID; the full Brand API
// (colours, fonts) requires a paid plan, so we stop here.

const SEARCH_ENDPOINT = "https://api.brandfetch.io/v2/search/";

export type BrandfetchHit = {
  name: string;
  domain: string;
  icon: string | null;
  brandId: string;
  claimed: boolean;
};

export type BrandfetchSearchOptions = {
  signal?: AbortSignal;
  // Public search returns up to 4-5 hits typically; we only ever want the top.
  // Exposed for testability / future "show alternatives" UX.
  takeFirstClaimed?: boolean;
};

const RAW_HIT_REQUIRED_KEYS = ["name", "domain", "brandId"] as const;

const isLikelyHit = (raw: unknown): raw is Record<string, unknown> => {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  return RAW_HIT_REQUIRED_KEYS.every(
    (k) => typeof r[k] === "string" && (r[k] as string).length > 0,
  );
};

// Pure picker, exported for tests. Given a list of raw hits, pick the best
// candidate per the policy described above.
export function pickBestHit(
  hits: ReadonlyArray<BrandfetchHit>,
  takeFirstClaimed: boolean,
): BrandfetchHit | null {
  if (hits.length === 0) return null;
  if (!takeFirstClaimed) return hits[0];
  const claimed = hits.find((h) => h.claimed);
  return claimed ?? hits[0];
}

// Pure normaliser, exported for tests. Maps Brandfetch's raw response shape
// into our internal BrandfetchHit type, tolerating missing optional fields.
export function normaliseHits(raw: unknown): BrandfetchHit[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isLikelyHit).map((h) => ({
    name: h.name as string,
    domain: h.domain as string,
    brandId: h.brandId as string,
    icon: typeof h.icon === "string" && h.icon.length > 0 ? h.icon : null,
    claimed: h.claimed === true,
  }));
}

export async function searchBrand(
  query: string,
  opts: BrandfetchSearchOptions = {},
): Promise<BrandfetchHit | null> {
  const clientId = process.env.BRANDFETCH_CLIENT_ID;
  if (!clientId) throw new Error("BRANDFETCH_CLIENT_ID is not set");

  const trimmed = query.trim();
  if (trimmed.length === 0) return null;

  const url = `${SEARCH_ENDPOINT}${encodeURIComponent(trimmed)}?c=${encodeURIComponent(clientId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: opts.signal,
  });

  if (!res.ok) {
    // Brandfetch returns 404 with `{ message: "Brand not found" }` for
    // empty searches, treat as a clean "no hit" rather than throwing.
    if (res.status === 404) return null;
    throw new Error(
      `Brandfetch search ${res.status} for "${trimmed}": ${await res
        .text()
        .catch(() => "")}`.slice(0, 500),
    );
  }

  const json = (await res.json()) as unknown;
  const hits = normaliseHits(json);
  return pickBestHit(hits, opts.takeFirstClaimed ?? true);
}

// Build a Brandfetch CDN logo URL. Canonical pattern per Brandfetch's
// current docs: `cdn.brandfetch.io/{domain}?c={clientId}`. The CDN also
// cross-checks the request Referer against the allowed-origins list
// registered to the client ID, so the URL succeeding in production
// requires the deploy domain (and `localhost:3000` for dev) to be added
// in the Brandfetch dashboard. The client ID itself is non-sensitive
// by Brandfetch's design (meant to ship in <img src>).
export function brandfetchLogoUrl(domain: string, clientId: string): string {
  return `https://cdn.brandfetch.io/${encodeURIComponent(domain)}?c=${encodeURIComponent(clientId)}`;
}
