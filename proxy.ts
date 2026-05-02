import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Routes that require an authenticated session. Unauthenticated visitors
// (including users who just deleted their account) get redirected to /
// rather than to Clerk's sign-in page so the homepage stays the single
// entry point for the unauthed experience.
const isProtectedRoute = createRouteMatcher(["/workspace(.*)"]);

export const proxy = clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();

  if (isProtectedRoute(req) && !userId) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (req.nextUrl.pathname === "/" && userId) {
    return NextResponse.redirect(new URL("/workspace/profile", req.url));
  }
});

export const proxyConfig = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
