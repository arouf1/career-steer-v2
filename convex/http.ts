import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

const TIMESTAMP_TOLERANCE_SECONDS = 300;

const base64Decode = (input: string): Uint8Array => {
  const binary = atob(input);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

const base64Encode = (bytes: Uint8Array): string => {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const verifySvixSignature = async (
  rawBody: string,
  headers: Headers,
  secret: string,
): Promise<boolean> => {
  const svixId = headers.get("svix-id");
  const svixTimestamp = headers.get("svix-timestamp");
  const svixSignature = headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TIMESTAMP_TOLERANCE_SECONDS) return false;

  const secretRaw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64Decode(secretRaw);
  } catch {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload) as BufferSource,
  );
  const expectedSig = base64Encode(new Uint8Array(signatureBytes));

  for (const item of svixSignature.split(" ")) {
    const [version, sig] = item.split(",");
    if (version === "v1" && sig && timingSafeEqual(sig, expectedSig)) {
      return true;
    }
  }
  return false;
};

const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
};

type ClerkUserDeletedEvent = {
  type: "user.deleted";
  data: { id?: string; deleted?: boolean };
};

type ClerkUserUpsertEvent = {
  type: "user.created" | "user.updated";
  data: {
    id: string;
    email_addresses?: Array<{ id: string; email_address: string }>;
    primary_email_address_id?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    image_url?: string | null;
  };
};

type ClerkEvent = ClerkUserDeletedEvent | ClerkUserUpsertEvent | { type: string; data: unknown };

// ── CORS for browser-callable endpoints ─────────────────────────────────────
const CORS_HEADERS: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "86400",
};

const jsonResponse = (
  body: unknown,
  init: ResponseInit = { status: 200 },
): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...CORS_HEADERS,
      ...(init.headers ?? {}),
    },
  });

const optionsResponse = (): Response =>
  new Response(null, { status: 204, headers: CORS_HEADERS });

const extractClientIp = (headers: Headers): string => {
  const forwarded =
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for") ??
    headers.get("x-real-ip");
  if (!forwarded) return "unknown";
  const first = forwarded.split(",")[0]?.trim();
  return first || "unknown";
};

// ── /career-guides/validate ─────────────────────────────────────────────────

http.route({
  path: "/career-guides/validate",
  method: "OPTIONS",
  handler: httpAction(async () => optionsResponse()),
});

http.route({
  path: "/career-guides/validate",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    let body: { career?: unknown };
    try {
      body = (await req.json()) as { career?: unknown };
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
    }
    const career = typeof body.career === "string" ? body.career.trim() : "";
    if (career.length < 2 || career.length > 100) {
      return jsonResponse(
        { error: "Career must be 2 to 100 characters" },
        { status: 400 },
      );
    }

    const clientIp = extractClientIp(req.headers);
    const result = await ctx.runMutation(
      internal.careerGuides._requestValidation,
      { career, clientIp },
    );
    return jsonResponse(result);
  }),
});

// ── /career-guides/generate ─────────────────────────────────────────────────

http.route({
  path: "/career-guides/generate",
  method: "OPTIONS",
  handler: httpAction(async () => optionsResponse()),
});

http.route({
  path: "/career-guides/generate",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    let body: { title?: unknown };
    try {
      body = (await req.json()) as { title?: unknown };
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
    }
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 2 || title.length > 100) {
      return jsonResponse(
        { error: "Title must be 2 to 100 characters" },
        { status: 400 },
      );
    }

    const clientIp = extractClientIp(req.headers);
    const result = await ctx.runAction(
      internal.careerGuides.requestGuideFromSearch,
      { title, clientIp },
    );
    return jsonResponse(result);
  }),
});

// ── Clerk webhook ───────────────────────────────────────────────────────────

http.route({
  path: "/clerk-webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN;

    if (!secret) {
      console.error("clerk-webhook: CLERK_WEBHOOK_SIGNING_SECRET not set");
      return new Response("misconfigured", { status: 500 });
    }
    if (!issuer) {
      console.error("clerk-webhook: CLERK_JWT_ISSUER_DOMAIN not set");
      return new Response("misconfigured", { status: 500 });
    }

    const rawBody = await req.text();
    const ok = await verifySvixSignature(rawBody, req.headers, secret);
    if (!ok) {
      return new Response("invalid signature", { status: 401 });
    }

    let evt: ClerkEvent;
    try {
      evt = JSON.parse(rawBody) as ClerkEvent;
    } catch {
      return new Response("invalid json", { status: 400 });
    }

    if (evt.type === "user.deleted") {
      const data = (evt as ClerkUserDeletedEvent).data;
      if (!data?.id) return new Response("missing id", { status: 400 });
      const tokenIdentifier = `${issuer}|${data.id}`;
      await ctx.runMutation(internal.users.deleteByTokenIdentifierInternal, {
        tokenIdentifier,
      });
      return new Response("ok", { status: 200 });
    }

    return new Response("ok", { status: 200 });
  }),
});

export default http;
