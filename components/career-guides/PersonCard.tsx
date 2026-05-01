"use client";

import Image from "next/image";
import { useState } from "react";
import { ArrowUpRight, MessageSquare } from "lucide-react";
import { motion } from "motion/react";
import type { Id } from "@/convex/_generated/dataModel";
import { OutreachDraftDrawer } from "./OutreachDraftDrawer";

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

type Person = {
  _id: Id<"key_people">;
  name: string;
  headline: string;
  linkedinUrl: string;
  imageUrl?: string;
  profileSummary: string;
  currentRole: string;
  currentCompany: string;
  relevanceReason: string;
};

// Five soft tints used to vary the avatar fallback so a wall of cards has
// some rhythm even when no profile photos came through.
const AVATAR_TINTS = [
  "bg-[var(--paper-raised)]",
  "bg-[oklch(0.94_0.02_85)]",
  "bg-[oklch(0.94_0.025_30)]",
  "bg-[oklch(0.94_0.02_245)]",
  "bg-[oklch(0.94_0.025_140)]",
];

const tintFor = (name: string): string => {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_TINTS[Math.abs(h) % AVATAR_TINTS.length];
};

const initialsFor = (name: string): string => {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
};

export function PersonCard({ person }: { person: Person }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <motion.article
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.2, 0.65, 0.3, 1] }}
        className="flex h-full flex-col rounded-card border border-hairline bg-paper-raised p-6 transition-colors hover:border-hairline-strong"
      >
        <div className="flex items-start gap-4">
          <Avatar imageUrl={person.imageUrl} name={person.name} />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[16px] font-medium leading-tight text-ink">
              {person.name}
            </h3>
            <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-mute">
              {person.headline}
            </p>
          </div>
        </div>

        <p className="mt-5 line-clamp-4 text-[14px] leading-relaxed text-ink/80">
          {person.profileSummary}
        </p>

        {person.relevanceReason && (
          <div className="mt-5 rounded-card border border-hairline bg-paper px-4 py-3">
            <p className={eyebrowCls}>Why them</p>
            <p className="mt-1.5 line-clamp-3 text-[13px] leading-snug text-ink/80">
              {person.relevanceReason}
            </p>
          </div>
        )}

        <div className="mt-6 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-pill bg-ink px-4 py-2.5 text-[13px] font-medium text-paper transition-colors hover:bg-ink-deep"
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
            Draft message
          </button>
          <a
            href={person.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-pill border border-hairline bg-paper px-4 py-2.5 text-[13px] font-medium text-ink transition-colors hover:bg-paper-raised"
          >
            LinkedIn
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden strokeWidth={1.75} />
          </a>
        </div>
      </motion.article>

      {drawerOpen && (
        <OutreachDraftDrawer
          person={person}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </>
  );
}

// LinkedIn's signed photo URLs (`profile-displayphoto-shrink_*`) rotate on a
// short TTL — by the time we render, many have either 4xx'd or quietly
// redirected to a generic placeholder. The placeholder *loads successfully*
// (so `onError` alone doesn't catch it), but it's small (typically
// ≤200px square). Anything below this threshold is treated as a non-photo
// and the card falls back to the colored initials tile.
const PHOTO_MIN_NATURAL_PX = 96;

function Avatar({ imageUrl, name }: { imageUrl?: string; name: string }) {
  const [failed, setFailed] = useState(false);

  if (!imageUrl || failed) {
    return <InitialsTile name={name} />;
  }

  return (
    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-pill border border-hairline">
      <Image
        src={imageUrl}
        alt={`Profile photo of ${name}`}
        width={48}
        height={48}
        className="h-full w-full object-cover"
        onError={() => setFailed(true)}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (
            img.naturalWidth < PHOTO_MIN_NATURAL_PX ||
            img.naturalHeight < PHOTO_MIN_NATURAL_PX
          ) {
            setFailed(true);
          }
        }}
        unoptimized
      />
    </div>
  );
}

function InitialsTile({ name }: { name: string }) {
  return (
    <div
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-pill border border-hairline ${tintFor(name)}`}
      aria-hidden
    >
      <span className="text-[13px] font-medium text-ink/70">
        {initialsFor(name)}
      </span>
    </div>
  );
}
