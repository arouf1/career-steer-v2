// components/workspace/conversations/ConversationSection.tsx
//
// Editorial section header for /workspace/conversations. Today / Yesterday /
// This week / Earlier. Serif italic label + hairline rule, no chromatic accent.

import { GROUP_LABEL, type GroupKey } from "./groupConversationsByDate";

type Props = { groupKey: GroupKey };

export function ConversationSection({ groupKey }: Props) {
  return (
    <div className="flex items-center gap-3 pb-2 pt-6 first:pt-0">
      <h2 className="[font-family:var(--font-serif)] text-[13px] font-normal italic text-mute">
        {GROUP_LABEL[groupKey]}
      </h2>
      <div className="flex-1 border-t border-hairline" />
    </div>
  );
}
