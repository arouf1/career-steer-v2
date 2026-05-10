"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Brandfetch CDN URL, canonical pattern is `cdn.brandfetch.io/{domain}?c=`.
// Their CDN cross-checks Referer against the allowed-origins list configured
// for the client ID; if the deploy domain isn't whitelisted the request 302s
// and our <img> onError handler falls through to the initials. Returns null
// when the client ID env var isn't set so we skip Brandfetch entirely.
function brandfetchCdnFallback(domain: string): string | null {
  const clientId = process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID;
  if (!clientId) return null;
  return `https://cdn.brandfetch.io/${encodeURIComponent(domain)}?c=${encodeURIComponent(clientId)}`;
}

export function CompanyMark({
  companyName,
  logoUrl,
  domain,
}: {
  companyName: string | null;
  logoUrl: string | null;
  domain: string | null;
}) {
  const [imgError, setImgError] = useState(false);
  const name = companyName ?? "";
  const candidateUrl =
    !imgError && logoUrl
      ? logoUrl
      : !imgError && domain
        ? brandfetchCdnFallback(domain) ?? null
        : null;

  if (candidateUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={candidateUrl}
        alt=""
        width={44}
        height={44}
        className="size-11 shrink-0 rounded-surface bg-paper object-contain p-1"
        onError={() => setImgError(true)}
      />
    );
  }
  if (name.length > 0) {
    return (
      <div className="flex size-11 shrink-0 items-center justify-center rounded-surface bg-paper-raised text-sm font-medium text-ink/70">
        {getInitials(name)}
      </div>
    );
  }
  return (
    <div className="flex size-11 shrink-0 items-center justify-center rounded-surface bg-paper-raised text-ink/40">
      <Building2 className="size-5" strokeWidth={1.5} />
    </div>
  );
}
