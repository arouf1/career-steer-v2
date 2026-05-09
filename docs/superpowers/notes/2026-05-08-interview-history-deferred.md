# Interview history surfacing deferred

Task 15 of the interview-simulation plan calls for distinguishing
`surface === "interview_job"` rows in the existing voice-call history
list with a "Mock interview" chip. As of 2026-05-08, no such list exists in
the codebase.

Verified absence by searching for `voice_calls`, `VoiceCallHistory`,
`listMyCalls`, and similar identifiers under `app/` and `components/`.

## What was found

- `convex/voiceCalls.ts` exports `getActiveSessionForUser`, `getCallById`,
  and several internal helpers — no list/history query exists.
- `components/career-guides/useDeepDiveCall.ts`, `components/jobs/voice/useJobVoiceCall.ts`,
  and `components/career-compass/voice/useCompassVoiceCall.ts` all call
  `appendMessage` and `finalize` only — no history rendering.
- No component under `app/` or `components/` renders a list of past calls.

## Action when a history list is added

When a workspace call-history list is built, render `surface === "interview_job"`
rows with the chip below, placed consistently with other per-row labels:

```tsx
{call.surface === "interview_job" && (
  <span className="inline-flex items-center rounded-pill bg-ink/5 px-2 py-0.5 text-[11px] font-medium text-ink">
    Mock interview
  </span>
)}
```

The new rows are already correctly persisted with `surface: "interview_job"` —
the gap is purely render-side.

## Smoke checklist note for Task 16

- [ ] History surfacing deferred — no list exists yet. When a call-history
      surface is added, add the "Mock interview" chip for `interview_job` rows
      (see chip JSX above).
