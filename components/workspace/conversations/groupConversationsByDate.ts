// components/workspace/conversations/groupConversationsByDate.ts
//
// Pure helper that buckets a chronologically-ordered list of conversation rows
// into the four editorial sections rendered on /workspace/conversations:
// Today / Yesterday / This week / Earlier.
//
// Boundary rules:
//   - "today"     → createdAt is on or after local midnight today
//   - "yesterday" → createdAt is on or after local midnight yesterday (and before today)
//   - "thisWeek"  → createdAt is within the last 7 days (inclusive of today)
//   - "earlier"   → everything older
//
// Empty groups are omitted from the returned list so the UI never renders an
// empty section header.

export type GroupKey = "today" | "yesterday" | "thisWeek" | "earlier";

export const GROUP_LABEL: Record<GroupKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  earlier: "Earlier",
};

export type GroupedConversations<T> = Array<{ key: GroupKey; rows: T[] }>;

export function groupConversationsByDate<T extends { createdAt: number }>(
  rows: T[],
  now: number = Date.now(),
): GroupedConversations<T> {
  // Normalise to local-time midnight today so the buckets respect the user's
  // wall-clock day, not UTC.
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const yesterdayMs = todayMs - 24 * 60 * 60 * 1000;
  // "this week" = the 6 days before today (so 7 days inclusive of today).
  const weekMs = todayMs - 6 * 24 * 60 * 60 * 1000;

  const buckets: Record<GroupKey, T[]> = {
    today: [],
    yesterday: [],
    thisWeek: [],
    earlier: [],
  };

  for (const r of rows) {
    if (r.createdAt >= todayMs) buckets.today.push(r);
    else if (r.createdAt >= yesterdayMs) buckets.yesterday.push(r);
    else if (r.createdAt >= weekMs) buckets.thisWeek.push(r);
    else buckets.earlier.push(r);
  }

  return (["today", "yesterday", "thisWeek", "earlier"] as GroupKey[])
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({ key: k, rows: buckets[k] }));
}
