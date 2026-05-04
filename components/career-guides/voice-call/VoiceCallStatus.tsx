"use client";

type Props = {
  statusText: string;
  error?: string | null;
};

export function VoiceCallStatus({ statusText, error }: Props) {
  return (
    <div className="space-y-3 text-center">
      <p className="text-[14px] leading-relaxed text-ink/55">{statusText}</p>
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-[13px] text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}
