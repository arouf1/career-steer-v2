import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const proxy = clerkMiddleware(async (auth, req) => {
  if (req.nextUrl.pathname === "/") {
    const { userId } = await auth();
    if (userId) {
      return NextResponse.redirect(new URL("/profile", req.url));
    }
  }
});

export const proxyConfig = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
