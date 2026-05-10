"use node";

// Per-event Resend email fired the moment the catalog-expansion cron
// schedules a new guide. One email per autonomous publish, fire-and-forget:
// a failed send is logged but never propagates back to cancel the guide
// creation. The guide row is the source of truth; the email is observability.
//
// Mirrors v1's searchConsole/notifyCreate.ts pattern (raw fetch, plain HTML,
// onboarding@resend.dev sender). The v1 sender domain was never verified;
// when we wire up a verified domain on Resend, swap the FROM_ADDRESS
// constant.

import { v } from "convex/values";
import { internalAction } from "./_generated/server";

const PROD_ORIGIN = "https://www.careersteer.com";
const FROM_ADDRESS = "Career Steer <onboarding@resend.dev>";
const CONVEX_DASHBOARD_PROJECT =
  process.env.CONVEX_DASHBOARD_URL ??
  "https://dashboard.convex.dev";

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const sendCatalogCreateEmail = internalAction({
  args: {
    slug: v.string(),
    title: v.string(),
    industryBucket: v.string(),
    judgeReasoning: v.string(),
    judgeConfidence: v.number(),
  },
  returns: v.object({
    sent: v.boolean(),
    skippedReason: v.optional(v.string()),
  }),
  handler: async (_ctx, args) => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn("[catalogEmail] RESEND_API_KEY not set, skipping");
      return { sent: false, skippedReason: "no_api_key" };
    }
    const recipient = process.env.CATALOG_REPORT_EMAIL;
    if (!recipient) {
      console.warn(
        "[catalogEmail] CATALOG_REPORT_EMAIL not set, skipping",
      );
      return { sent: false, skippedReason: "no_recipient" };
    }

    const guideUrl = `${PROD_ORIGIN}/career-guides/${args.slug}`;
    const dashboardUrl = `${CONVEX_DASHBOARD_PROJECT}/data?table=career_guides`;

    const subject = `[CareerSteer] New guide queued: ${args.title}`;

    const html = `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 640px; margin: 0 auto; color: #1a1a1a;">
  <h2 style="margin: 0 0 12px;">New career guide queued</h2>
  <p style="margin: 0 0 16px; color: #555;">The catalog-expansion cron just scheduled a new guide for generation.</p>

  <table style="border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 14px;">
    <tr><td style="padding: 6px 0; color: #555;">Title</td><td style="padding: 6px 0;"><strong>${escapeHtml(args.title)}</strong></td></tr>
    <tr><td style="padding: 6px 0; color: #555;">Live URL (when complete)</td><td style="padding: 6px 0;"><a href="${guideUrl}">${guideUrl}</a></td></tr>
    <tr><td style="padding: 6px 0; color: #555;">Industry bucket</td><td style="padding: 6px 0;">${escapeHtml(args.industryBucket)}</td></tr>
    <tr><td style="padding: 6px 0; color: #555;">Judge confidence</td><td style="padding: 6px 0;">${args.judgeConfidence.toFixed(2)}</td></tr>
    <tr><td style="padding: 6px 0; color: #555;">Judge reasoning</td><td style="padding: 6px 0;">${escapeHtml(args.judgeReasoning)}</td></tr>
  </table>

  <p style="margin: 24px 0 8px; font-size: 13px; color: #555;">
    <a href="${dashboardUrl}">Open Convex dashboard</a> ·
    <a href="${guideUrl}">Open guide</a>
  </p>

  <hr style="border: 0; border-top: 1px solid #eee; margin: 32px 0;" />
  <p style="font-size: 12px; color: #888;">
    This message fires for every autonomous catalog-expansion create.
    To pause autonomous expansion, remove or comment the
    <code>"expand career guide catalog"</code> entry in
    <code>convex/crons.ts</code>.
  </p>
</body></html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [recipient],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(
        `[catalogEmail] send failed ${res.status}: ${body.slice(0, 200)}`,
      );
      return { sent: false, skippedReason: `http_${res.status}` };
    }
    console.log(
      `[catalogEmail] sent for ${args.slug} (${args.industryBucket})`,
    );
    return { sent: true };
  },
});
