/**
 * Pure helpers for the interview-research pipeline:
 *   - Build the 5 Exa queries used by `_synthesizeInterviewResearch`.
 *   - Check freshness against the 30-day (bundle) and 7-day (news) TTLs.
 *
 * No I/O, no Convex context, easy to unit-test.
 */

export const BUNDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const NEWS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InterviewQueryArgs = {
  companyName: string;
  roleTitle: string;
};

export type InterviewQueryKey = "loop" | "questions" | "rigor" | "prestigeSignals";

const slugToProse = (s: string): string => s.replace(/-+/g, " ").trim();

export function buildInterviewQueries(
  args: InterviewQueryArgs,
): Record<InterviewQueryKey, string> {
  const role = slugToProse(args.roleTitle);
  const co = args.companyName;
  return {
    loop: `Describe the interview process for ${role} roles at ${co}: how many rounds, what each round assesses, format (panel / 1:1 / take-home / live coding / case), and what to expect. Use what candidates have shared publicly.`,
    questions: `What interview questions have ${role} candidates at ${co} reported being asked? Include behavioral, technical, and case questions where applicable.`,
    rigor: `On Glassdoor, levels.fyi, and similar sites, how difficult is the interview at ${co}, especially for ${role} roles? Include any reported difficulty score (1-5) and how selective the company is reported to be.`,
    prestigeSignals: `For candidates applying as ${role} at ${co}, summarise the company: approximate employee headcount, public/private, latest funding round if private, recent revenue if known, and how widely recognised the brand is. Be specific where possible.`,
  };
}

export function buildNewsQuery(args: { companyName: string }): string {
  return `What are the most notable recent news stories about ${args.companyName} from the last 90 days? Include announcements, product launches, leadership changes, layoffs, funding events, partnerships, controversies, or financial milestones.`;
}

export function isBundleStale(
  generatedAt: number | undefined,
  now: number = Date.now(),
): boolean {
  if (!generatedAt) return true;
  return now - generatedAt > BUNDLE_TTL_MS;
}

export function isNewsStale(
  fetchedAt: number | undefined,
  now: number = Date.now(),
): boolean {
  if (!fetchedAt) return true;
  return now - fetchedAt > NEWS_TTL_MS;
}
