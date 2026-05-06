// Thin wrapper around Google's Indexing API.
// Docs: https://developers.google.com/search/apis/indexing-api/v3/quickstart
//
// Quota: 200 publish requests per day per project. Rate-limiting is the
// caller's responsibility (see convex/googleIndexingQueue.ts) — this helper
// just sends one request and returns.
//
// Auth: a Google Service Account JSON in the env var
// GOOGLE_SERVICE_ACCOUNT_JSON (raw JSON or base64-encoded). The account must:
//   1. Have the "Owner" role on the property in Google Search Console.
//   2. Be granted access to the Indexing API in Google Cloud Console.
// We exchange the JSON for an OAuth2 access token via JWT, then POST to
// publishing.

const PUBLISH_ENDPOINT =
  "https://indexing.googleapis.com/v3/urlNotifications:publish";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/indexing";

type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export class IndexingApiNotConfiguredError extends Error {
  constructor() {
    super("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
    this.name = "IndexingApiNotConfiguredError";
  }
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function loadServiceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new IndexingApiNotConfiguredError();
  try {
    // Allow either raw JSON or base64-encoded JSON for env hygiene — some
    // env stores don't love multi-line strings.
    const text = raw.trim().startsWith("{") ? raw : atob(raw);
    const parsed = JSON.parse(text) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("missing client_email or private_key");
    }
    return parsed;
  } catch (err) {
    throw new Error(
      `Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

// Convert a PEM-encoded RSA private key into a CryptoKey usable by SubtleCrypto.
async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return globalThis.crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeJson(obj: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

async function mintAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const sa = loadServiceAccount();
  const tokenUri = sa.token_uri ?? TOKEN_ENDPOINT;
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncodeJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlEncodeJson({
    iss: sa.client_email,
    scope: SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  });
  const signingInput = `${header}.${payload}`;
  const key = await importRsaPrivateKey(sa.private_key);
  const sigBytes = await globalThis.crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(sigBytes))}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `Google token exchange ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

export async function notifyGoogle(
  url: string,
  type: "URL_UPDATED" | "URL_DELETED",
): Promise<void> {
  const token = await mintAccessToken();
  const res = await fetch(PUBLISH_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, type }),
  });
  if (!res.ok) {
    throw new Error(
      `Indexing API ${res.status} for ${type} ${url}: ${(await res.text()).slice(0, 300)}`,
    );
  }
}
