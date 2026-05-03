import Exa from "exa-js";

export type Citation = {
  url: string;
  title: string;
  publisher?: string;
  fetchedAt: number;
};

export type ExaAnswer = {
  answer: string;
  citations: Citation[];
  costCents: number;
};

const RETRY_ATTEMPTS = 4;
const RATE_LIMIT_BACKOFF_MS = 1200;
const TRANSIENT_BACKOFF_MS = 400;

let client: Exa | null = null;

const getClient = (): Exa => {
  if (!client) {
    const key = process.env.EXA_API_KEY;
    if (!key) throw new Error("EXA_API_KEY is not set");
    client = new Exa(key);
  }
  return client;
};

const isRateLimit = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b|rate limit|too many requests/i.test(msg);
};

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

const normalizeCitation = (c: {
  url: string;
  title: string | null;
  author?: string;
}): Citation => ({
  url: c.url,
  title: c.title ?? c.url,
  publisher: c.author?.trim() || undefined,
  fetchedAt: Date.now(),
});

export async function exaAnswer(
  query: string,
  opts?: { systemPrompt?: string; signal?: AbortSignal },
): Promise<ExaAnswer> {
  const exa = getClient();
  let lastError: unknown;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    if (opts?.signal?.aborted) throw new Error("aborted");
    try {
      const res = await exa.answer(query, {
        systemPrompt: opts?.systemPrompt,
      });
      const answer =
        typeof res.answer === "string"
          ? res.answer
          : JSON.stringify(res.answer);
      const citations = (res.citations ?? []).map(normalizeCitation);
      const costCents = res.costDollars?.total
        ? Math.round(res.costDollars.total * 100 * 100) / 100
        : 0.5;
      return { answer, citations, costCents };
    } catch (err) {
      lastError = err;
      if (attempt === RETRY_ATTEMPTS) break;
      const base = isRateLimit(err)
        ? RATE_LIMIT_BACKOFF_MS
        : TRANSIENT_BACKOFF_MS;
      const jitter = Math.floor(Math.random() * 200);
      await sleep(base * attempt + jitter, opts?.signal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Exa answer failed: ${String(lastError)}`);
}

// ── LinkedIn-targeted search ──────────────────────────────────────────────
// Used by the "people in this field" feature on career-guide detail pages.
// Returns LinkedIn profile pages with snippet text we feed to a model for
// structured extraction. The exa-js SDK does not yet expose `costDollars`
// on its typed response, so we read it through `unknown` rather than
// asserting it on the SDK shape.

export type ExaLinkedInResult = {
  url: string;
  title: string;
  text: string;
  // Profile photo URL if Exa happened to surface one in the page text
  // (LinkedIn embeds a `profile-displayphoto-shrink_*` URL alongside
  // most public profiles).
  imageUrl?: string;
};

export type ExaSearchResponse = {
  results: ExaLinkedInResult[];
  costCents: number;
};

const PROFILE_PHOTO_PATTERN = "profile-displayphoto-shrink_";
const PROFILE_PHOTO_URL_RE =
  /https:\/\/media\.licdn\.com\/dms\/image\/[^"\s)]*profile-displayphoto-shrink_[^"\s)]*/;

// ── Single-URL content fetch (used by LinkedIn import) ───────────────────
// `exa.getContents([url], { text: true })` is Exa's "scrape this exact URL
// and give me the readable text" call. It is what V1 used for the LinkedIn
// import path and what we use here too — LinkedIn has no public API and the
// Exa scraper handles the auth wall well enough to get the public profile
// content for retry-able fetches.

export type ExaContentResult = {
  url: string;
  title: string;
  text: string;
  author?: string;
  publishedDate?: string;
};

export async function exaGetContents(
  url: string,
  opts?: { signal?: AbortSignal },
): Promise<ExaContentResult> {
  const exa = getClient();
  let lastError: unknown;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    if (opts?.signal?.aborted) throw new Error("aborted");
    try {
      const res = await exa.getContents([url], { text: true });
      const first = (res.results ?? [])[0];
      if (!first || typeof first.text !== "string" || first.text.length === 0) {
        throw new Error("Exa returned no text content for the URL");
      }
      return {
        url: typeof first.url === "string" ? first.url : url,
        title: typeof first.title === "string" ? first.title : url,
        text: first.text,
        author:
          typeof (first as { author?: unknown }).author === "string"
            ? ((first as { author: string }).author)
            : undefined,
        publishedDate:
          typeof (first as { publishedDate?: unknown }).publishedDate ===
          "string"
            ? ((first as { publishedDate: string }).publishedDate)
            : undefined,
      };
    } catch (err) {
      lastError = err;
      if (attempt === RETRY_ATTEMPTS) break;
      const base = isRateLimit(err)
        ? RATE_LIMIT_BACKOFF_MS
        : TRANSIENT_BACKOFF_MS;
      const jitter = Math.floor(Math.random() * 200);
      await sleep(base * attempt + jitter, opts?.signal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Exa getContents failed: ${String(lastError)}`);
}

export async function exaSearchLinkedIn(
  query: string,
  opts?: {
    numResults?: number;
    signal?: AbortSignal;
  },
): Promise<ExaSearchResponse> {
  const exa = getClient();
  let lastError: unknown;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    if (opts?.signal?.aborted) throw new Error("aborted");
    try {
      const res = await exa.searchAndContents(query, {
        type: "auto",
        numResults: opts?.numResults ?? 10,
        includeDomains: ["linkedin.com"],
        text: { maxCharacters: 2000 },
      });

      const rawCost =
        (res as unknown as { costDollars?: { total?: number } })?.costDollars
          ?.total ?? 0;
      const costCents = Math.round(rawCost * 100 * 100) / 100;

      const results: ExaLinkedInResult[] = (res.results ?? [])
        .filter(
          (r): r is typeof r & { url: string; text: string } =>
            typeof r.url === "string" &&
            typeof r.text === "string" &&
            r.text.length >= 50,
        )
        .map((r) => {
          let imageUrl: string | undefined;
          if (r.text.includes(PROFILE_PHOTO_PATTERN)) {
            const m = r.text.match(PROFILE_PHOTO_URL_RE);
            if (m) imageUrl = m[0];
          }
          if (!imageUrl) {
            for (const val of Object.values(r)) {
              if (
                typeof val === "string" &&
                val.includes(PROFILE_PHOTO_PATTERN)
              ) {
                const m = val.match(PROFILE_PHOTO_URL_RE);
                if (m) {
                  imageUrl = m[0];
                  break;
                }
              }
            }
          }
          return {
            url: r.url,
            title: typeof r.title === "string" ? r.title : r.url,
            text: r.text,
            imageUrl,
          };
        });

      return { results, costCents };
    } catch (err) {
      lastError = err;
      if (attempt === RETRY_ATTEMPTS) break;
      const base = isRateLimit(err)
        ? RATE_LIMIT_BACKOFF_MS
        : TRANSIENT_BACKOFF_MS;
      const jitter = Math.floor(Math.random() * 200);
      await sleep(base * attempt + jitter, opts?.signal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Exa search failed: ${String(lastError)}`);
}
