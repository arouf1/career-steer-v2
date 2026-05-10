import type { NextConfig } from "next";

const convexHost = (() => {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      ...(convexHost
        ? ([
            {
              protocol: "https" as const,
              hostname: convexHost,
              pathname: "/api/storage/**",
            },
          ])
        : []),
    ],
  },
  // Permanent redirects for renamed career-guide slugs. The catalog-
  // expansion judge now applies its canonical-name corrections at the
  // schema level (see convex/catalogExpansion.ts), but pre-fix guides
  // shipped under the seed-derived slug. Each entry here pairs with a
  // one-shot rename migration in convex/migrations/.
  async redirects() {
    return [
      {
        source: "/career-guides/director-of-admissions",
        destination: "/career-guides/admissions-director",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
