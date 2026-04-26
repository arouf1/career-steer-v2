import { convexTest } from "convex-test";
import { describe, it, expect, vi, beforeEach } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";

// Mock the AI SDK call so we don't hit OpenRouter
vi.mock("ai", async () => {
  const actual = await vi.importActual<any>("ai");
  return {
    ...actual,
    generateText: vi.fn().mockResolvedValue({
      output: {
        name: "Test User",
        headline: "Engineer",
        summary: null,
        location: null,
        experience: [],
        education: [],
        skills: ["TypeScript"],
      },
    }),
  };
});

describe("profiles.parseUpload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated calls", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });
    await expect(
      t.action(api.profiles.parseUpload, { text: "hi", sourceFormat: "pdf" }),
    ).rejects.toThrow(/Not authenticated/);
  });

  it("upserts a profile on first parse", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });
    const asUser = t.withIdentity({ tokenIdentifier: "user|123", email: "a@b.co" });
    const result = await asUser.action(api.profiles.parseUpload, {
      text: "Some résumé text",
      sourceFormat: "pdf",
    });
    expect(result).toEqual({ ok: true });

    const profile = await asUser.query(api.profiles.current, {});
    expect(profile?.name).toBe("Test User");
    expect(profile?.skills).toEqual(["TypeScript"]);
    expect(profile?.rateLimit.countInWindow).toBe(1);
  });

  it("rejects text > 200_000 chars", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });
    const asUser = t.withIdentity({ tokenIdentifier: "user|123", email: "a@b.co" });
    const result = await asUser.action(api.profiles.parseUpload, {
      text: "x".repeat(200_001),
      sourceFormat: "pdf",
    });
    expect(result).toEqual({ ok: false, error: "TEXT_TOO_LONG" });
  });

  it("blocks the 6th parse in a 24h window", async () => {
    const t = convexTest({
      schema,
      modules: import.meta.glob("./**/*.ts"),
    });
    const asUser = t.withIdentity({ tokenIdentifier: "user|123", email: "a@b.co" });
    for (let i = 0; i < 5; i++) {
      const r = await asUser.action(api.profiles.parseUpload, { text: "ok", sourceFormat: "pdf" });
      expect(r).toEqual({ ok: true });
    }
    const r6 = await asUser.action(api.profiles.parseUpload, { text: "ok", sourceFormat: "pdf" });
    expect(r6).toEqual({ ok: false, error: "RATE_LIMIT" });
  });
});
