/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const harness = () =>
  convexTest({
    schema,
    modules: import.meta.glob("./**/*.ts"),
  });

describe("titleCanonicalization._writeThrough", () => {
  it("inserts when no existing row", async () => {
    const t = harness();
    const result = await t.mutation(
      internal.titleCanonicalization._writeThrough,
      {
        prefilteredKey: "senior software engineer",
        sourceTitle: "Sr. Software Engineer",
        canonicalTitle: "Senior Software Engineer",
        model: "google/gemini-3.1-pro-preview",
        confidence: 0.95,
      },
    );
    expect(result.canonicalTitle).toBe("Senior Software Engineer");
    expect(result.cached).toBe(false);
  });

  it("returns existing row instead of duplicating (single-flight)", async () => {
    const t = harness();
    const first = await t.mutation(
      internal.titleCanonicalization._writeThrough,
      {
        prefilteredKey: "product manager",
        sourceTitle: "PM",
        canonicalTitle: "Product Manager",
        model: "google/gemini-3.1-pro-preview",
        confidence: 0.9,
      },
    );
    // Second writer proposes a different canonical for the same prefiltered key.
    const second = await t.mutation(
      internal.titleCanonicalization._writeThrough,
      {
        prefilteredKey: "product manager",
        sourceTitle: "P.M.",
        canonicalTitle: "PM (Product Manager)",
        model: "google/gemini-3.1-pro-preview",
        confidence: 0.85,
      },
    );

    // Second call returns the first writer's canonical — no duplicate.
    expect(second.canonicalTitle).toBe(first.canonicalTitle);
    expect(second.canonicalTitle).toBe("Product Manager");
    expect(second.cached).toBe(true);

    // Verify only one row exists.
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("title_canonicalizations")
        .withIndex("by_prefiltered_key", (q) =>
          q.eq("prefilteredKey", "product manager"),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
  });
});

describe("titleCanonicalization._lookup", () => {
  it("returns null on miss and the row on hit", async () => {
    const t = harness();
    const miss = await t.query(internal.titleCanonicalization._lookup, {
      prefilteredKey: "nonexistent",
    });
    expect(miss).toBeNull();

    await t.mutation(internal.titleCanonicalization._writeThrough, {
      prefilteredKey: "data scientist",
      sourceTitle: "Data Scientist",
      canonicalTitle: "Data Scientist",
      model: "google/gemini-3.1-pro-preview",
      confidence: 0.99,
    });
    const hit = await t.query(internal.titleCanonicalization._lookup, {
      prefilteredKey: "data scientist",
    });
    expect(hit?.canonicalTitle).toBe("Data Scientist");
  });
});
