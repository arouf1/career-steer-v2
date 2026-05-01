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
};

export default nextConfig;
