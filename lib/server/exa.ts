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
