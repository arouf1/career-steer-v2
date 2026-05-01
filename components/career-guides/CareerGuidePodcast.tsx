"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  ChevronDown,
  Headphones,
  Loader2,
  Pause,
  Play,
} from "lucide-react";
import type { GuideWithUrl } from "@/convex/careerGuides";

type Props = {
  guide: GuideWithUrl;
};

const HOST_NAME = "Alice Clements";

export function CareerGuidePodcast({ guide }: Props) {
  // Subscribe to the live guide doc so the section transitions from
  // "generating" to "ready" without a page reload. Falls back to the
  // SSR-rendered prop until the websocket connects.
  const live = useQuery(api.careerGuides.getBySlug, { slug: guide.slug });
  const current = live ?? guide;
  const podcast = current.podcast;
  if (!podcast) return null;

  if (podcast.status === "failed") return null;

  if (podcast.status !== "complete" || !current.podcastAudioUrl) {
    return <PendingCard />;
  }

  return (
    <ReadyCard
      audioUrl={current.podcastAudioUrl}
      transcript={podcast.transcript ?? []}
      guestName={podcast.guestName ?? "Guest"}
      guestRole={podcast.guestRole ?? ""}
      durationSeconds={podcast.durationSeconds}
    />
  );
}

function PendingCard() {
  return (
    <section
      id="podcast"
      aria-label="Career Cast generating"
      className="mt-10 mb-12 flex items-center gap-4 rounded-surface border border-hairline bg-paper-raised px-5 py-5"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-pill border border-hairline bg-paper">
        <Loader2 className="h-4 w-4 animate-spin text-mute" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.18em] font-medium text-mute">
          Career Cast
        </p>
        <p className="mt-1 text-[15px] leading-relaxed text-ink/85">
          Recording a five-minute conversation about this career.
        </p>
      </div>
    </section>
  );
}

function ReadyCard({
  audioUrl,
  transcript,
  guestName,
  guestRole,
  durationSeconds,
}: {
  audioUrl: string;
  transcript: { speaker: "host" | "guest"; text: string }[];
  guestName: string;
  guestRole: string;
  durationSeconds?: number;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrentTime(audio.currentTime);
    const onMeta = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnd = () => setIsPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnd);
    };
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play();
    else audio.pause();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (e.clientX - rect.left) / rect.width),
    );
    audio.currentTime = ratio * duration;
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <section
      id="podcast"
      aria-label="Career Cast episode"
      className="mt-10 mb-12 overflow-hidden rounded-surface border border-hairline bg-paper-raised"
    >
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      <div className="flex flex-col gap-5 px-5 py-5 sm:flex-row sm:items-center sm:gap-6 sm:px-6 sm:py-6">
        <button
          type="button"
          onClick={toggle}
          aria-label={isPlaying ? "Pause podcast" : "Play podcast"}
          className="group flex h-14 w-14 shrink-0 items-center justify-center rounded-pill border border-ink/10 bg-ink text-paper transition-transform duration-200 hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30"
        >
          {isPlaying ? (
            <Pause className="h-5 w-5" aria-hidden />
          ) : (
            <Play className="ml-0.5 h-5 w-5" aria-hidden />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] font-medium text-mute">
            <Headphones className="h-3 w-3" aria-hidden />
            <span>Career Cast</span>
          </div>
          <h2 className="mt-1.5 text-[18px] leading-snug text-ink [font-family:var(--font-serif)]">
            {HOST_NAME} talks with {guestName}
          </h2>
          {guestRole && (
            <p className="mt-1 truncate text-[13px] text-mute">{guestRole}</p>
          )}

          <div className="mt-4 flex items-center gap-3">
            <div
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Math.max(1, Math.round(duration))}
              aria-valuenow={Math.round(currentTime)}
              tabIndex={0}
              onClick={seek}
              className="group h-1 flex-1 cursor-pointer rounded-pill bg-ink/10"
            >
              <div
                className="h-1 rounded-pill bg-ink transition-[width] duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="shrink-0 text-[12px] tabular-nums text-mute">
              {formatTime(currentTime)} /{" "}
              {formatTime(duration || durationSeconds || 0)}
            </span>
          </div>
        </div>
      </div>

      {transcript.length > 0 && (
        <div className="border-t border-hairline">
          <button
            type="button"
            onClick={() => setTranscriptOpen((v) => !v)}
            aria-expanded={transcriptOpen}
            className="flex w-full items-center justify-between px-5 py-3.5 text-[13px] text-mute transition-colors hover:text-ink sm:px-6"
          >
            <span>Transcript</span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-300 ${transcriptOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          {transcriptOpen && (
            <div className="space-y-4 border-t border-hairline px-5 py-5 sm:px-6 sm:py-6">
              {transcript.map((turn, i) => (
                <div key={i} className="flex gap-4">
                  <span
                    className={`w-20 shrink-0 text-[11px] uppercase tracking-[0.16em] ${
                      turn.speaker === "host"
                        ? "text-ink/60"
                        : "text-state-warning/80"
                    }`}
                  >
                    {turn.speaker === "host" ? "Alice" : guestName.split(" ")[0]}
                  </span>
                  <p className="flex-1 text-[15px] leading-[1.65] text-ink/85">
                    {turn.text}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
