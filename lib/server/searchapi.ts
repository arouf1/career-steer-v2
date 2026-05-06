// Thin wrapper around SearchAPI's Google Jobs endpoint.
// Mirrors the lib/server/exa.ts shape: env-key-on-demand, retry on transient
// errors, narrow internal type for only the fields we consume.
//
// Docs: https://www.searchapi.io/docs/google-jobs

const ENDPOINT = "https://www.searchapi.io/api/v1/search";

const RETRY_ATTEMPTS = 3;
const RATE_LIMIT_BACKOFF_MS = 1500;
const TRANSIENT_BACKOFF_MS = 400;

export type GoogleJobsParams = {
  query: string;
  location?: string;
  gl?: string;
  hl?: string;
  nextPageToken?: string;
  signal?: AbortSignal;
};

export type GoogleJobsApplyLink = {
  link?: string;
  source?: string;
};

export type GoogleJobsRawJob = {
  position?: number;
  title?: string;
  company_name?: string;
  location?: string;
  via?: string;
  description?: string;
  apply_link?: string;
  apply_links?: GoogleJobsApplyLink[];
  sharing_link?: string;
  thumbnail?: string;
  detected_extensions?: {
    schedule?: string;
    posted_at?: string;
    salary?: string;
    work_from_home?: boolean;
    health_insurance?: boolean;
    dental_insurance?: boolean;
    paid_time_off?: boolean;
  };
};

export type GoogleJobsRawResponse = {
  search_information?: {
    total_results?: number;
    detected_location?: string;
  };
  jobs?: GoogleJobsRawJob[];
  pagination?: {
    next_page_token?: string;
  };
  error?: string;
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

const isTransientStatus = (status: number): boolean =>
  status === 429 || status === 503 || status === 504;

export async function searchGoogleJobs(
  params: GoogleJobsParams,
): Promise<GoogleJobsRawResponse> {
  const apiKey = process.env.SEARCH_API_KEY;
  if (!apiKey) throw new Error("SEARCH_API_KEY is not set");

  const url = new URL(ENDPOINT);
  url.searchParams.set("engine", "google_jobs");
  url.searchParams.set("q", params.query);
  if (params.location) url.searchParams.set("location", params.location);
  if (params.gl) url.searchParams.set("gl", params.gl);
  if (params.hl) url.searchParams.set("hl", params.hl);
  if (params.nextPageToken)
    url.searchParams.set("next_page_token", params.nextPageToken);

  let lastError: unknown;

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    if (params.signal?.aborted) throw new Error("aborted");
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: params.signal,
      });

      if (!res.ok) {
        // Try to surface the upstream error message; SearchAPI returns
        // { error: "..." } on validation/auth failures.
        let message = `SearchAPI HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = `${message}: ${body.error}`;
        } catch {
          // body wasn't JSON; keep the status-based message
        }
        if (isTransientStatus(res.status) && attempt < RETRY_ATTEMPTS) {
          lastError = new Error(message);
          const base =
            res.status === 429 ? RATE_LIMIT_BACKOFF_MS : TRANSIENT_BACKOFF_MS;
          await sleep(base * attempt, params.signal);
          continue;
        }
        throw new Error(message);
      }

      return (await res.json()) as GoogleJobsRawResponse;
    } catch (err) {
      lastError = err;
      // AbortError or non-HTTP fetch failure: only retry the latter.
      if (err instanceof Error && err.name === "AbortError") throw err;
      if (attempt === RETRY_ATTEMPTS) break;
      await sleep(TRANSIENT_BACKOFF_MS * attempt, params.signal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`SearchAPI request failed: ${String(lastError)}`);
}
