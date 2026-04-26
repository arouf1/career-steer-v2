---
description: Quick status read — git activity since last standup, open TODOs in code, recent Convex deploy log. One-shot, no recurring schedule.
---

# /standup

Run at the start of a session to see where things stand. Pure project tooling — no external skill being wrapped.

## What you will do

1. **Git activity.** Show commits since the most recent tag or, if no tag, the last 7 days:
   ```bash
   git log --since="7 days ago" --pretty=format:"%h %ad %s" --date=short
   git status --short
   ```

2. **Open TODOs in code.** Surface anything that's been left in the codebase as a marker:
   ```bash
   grep -rn --include='*.ts' --include='*.tsx' -E 'TODO|FIXME|XXX|HACK' app components convex lib 2>/dev/null | head -50
   ```

3. **Recent Convex activity.** Show the last 10 deploys and any failures:
   ```bash
   npx convex logs --history=10 2>/dev/null | tail -50
   ```

4. **Recent Vercel activity.** Show the last 5 deployments:
   ```bash
   npx vercel ls 2>/dev/null | head -10
   ```

5. **Synthesize, don't dump.** After running the commands, write a 5-bullet summary:
   - What landed since last standup
   - What's in flight (uncommitted, on a branch, in a draft PR)
   - What's blocked
   - Open TODOs worth picking up today
   - Suggested next action

## Operating reminders

- **Claude is the primary developer.** If standup surfaces a TODO that can be cleared in 10 minutes, just clear it — don't list it as a suggestion.
