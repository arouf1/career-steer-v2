import { z } from "zod";

// LinkedIn surfaces under both `linkedin.com` and 30+ regional sub-domains
// (uk.linkedin.com, jp.linkedin.com, ...). Ported verbatim from V1 because
// excluding any of them would silently break international users.
const LINKEDIN_REGIONAL_DOMAINS = [
  "linkedin.com",
  "www.linkedin.com",
  "uk.linkedin.com",
  "ca.linkedin.com",
  "au.linkedin.com",
  "in.linkedin.com",
  "de.linkedin.com",
  "fr.linkedin.com",
  "es.linkedin.com",
  "it.linkedin.com",
  "br.linkedin.com",
  "mx.linkedin.com",
  "jp.linkedin.com",
  "cn.linkedin.com",
  "sg.linkedin.com",
  "hk.linkedin.com",
  "tw.linkedin.com",
  "kr.linkedin.com",
  "th.linkedin.com",
  "my.linkedin.com",
  "ph.linkedin.com",
  "id.linkedin.com",
  "vn.linkedin.com",
  "za.linkedin.com",
  "ng.linkedin.com",
  "eg.linkedin.com",
  "ae.linkedin.com",
  "sa.linkedin.com",
  "il.linkedin.com",
  "tr.linkedin.com",
  "ru.linkedin.com",
  "pl.linkedin.com",
];

export const linkedinUrlSchema = z
  .string()
  .url("Please enter a valid URL")
  .refine((url) => {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return LINKEDIN_REGIONAL_DOMAINS.some(
        (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
      );
    } catch {
      return false;
    }
  }, "Please enter a LinkedIn URL")
  .refine((url) => {
    try {
      return new URL(url).pathname.includes("/in/");
    } catch {
      return false;
    }
  }, "Please enter a LinkedIn profile URL (should contain '/in/')");

// Heuristic for "this scrape came back as the signed-out wall, not the real
// profile". Used to drive the retry-on-private loop in the parseLinkedIn
// action. Ported from V1 — the indicators are the strings LinkedIn actually
// renders on the gated wall, so they only get false-positives on profiles
// whose real text happens to contain the same phrases (rare).
export function isPrivateLinkedInProfile(text: string): boolean {
  const indicators = [
    "Join to view profile",
    "Join to view full profile",
    "Sign in to view",
    "Join now to see all activity",
    "See their title, tenure and more",
    "By clicking Continue to join or sign in",
    "New to LinkedIn? Join now",
    "LinkedIn User Agreement",
  ];
  const indicatorCount = indicators.filter((needle) =>
    text.includes(needle),
  ).length;

  // "View Jane's full experience" / "View Jane Doe's full experience" — the
  // single-string tell that the profile is gated even when sign-in prompts
  // are absent.
  const hasViewFullExperience = /View\s+\w+['']s full experience/i.test(text);

  // Gated profiles often render long runs of asterisks in place of redacted
  // role titles / dates.
  const hasRedactedContent =
    /\*{5,}\s+\*{5,}/g.test(text) || /\\\*\\\*\\\*\\\*\\\*\\\*/g.test(text);

  // Profiles that scrape correctly have their real content; gated ones are
  // disproportionately navigation chrome. We use this as a tiebreaker only
  // when redactions are also present, to keep the false-positive rate low.
  const navigation = [
    "Skip to main content",
    "Contact Info",
    "followers",
    "connections",
    "See your mutual connections",
  ];
  const navCount = navigation.filter((needle) => text.includes(needle)).length;

  const hasMultipleSignInPrompts = indicatorCount >= 3 || hasViewFullExperience;
  const hasHighNavigationRatio = navCount >= 4;

  return (
    hasMultipleSignInPrompts || (hasRedactedContent && hasHighNavigationRatio)
  );
}
