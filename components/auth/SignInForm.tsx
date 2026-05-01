"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useSignIn } from "@clerk/nextjs/legacy";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { ClerkCaptcha } from "@/components/auth/ClerkCaptcha";
import { GoogleButton } from "@/components/auth/GoogleButton";

const ease = [0.2, 0.65, 0.3, 1] as const;

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function SignInForm() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const router = useRouter();

  const [formData, setFormData] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await signIn.create({
        identifier: formData.email,
        password: formData.password,
      });

      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        router.push("/profile");
      } else {
        setError("Sign in incomplete. Please try again.");
      }
    } catch (err: unknown) {
      const message =
        (err as { errors?: Array<{ message?: string }>; message?: string })
          ?.errors?.[0]?.message ??
        (err as { message?: string })?.message ??
        "Something went wrong. Please try again.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!isLoaded) return;

    setIsGoogleLoading(true);
    setError(null);

    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/profile",
      });
    } catch {
      setError("Failed to sign in with Google. Please try again.");
      setIsGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row relative bg-paper">
      {/* Mobile background illustration */}
      <div className="absolute inset-0 lg:hidden">
        <Image
          src="/sign-in.svg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover animate-in fade-in duration-1000"
        />
      </div>

      {/* Form column */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 lg:p-12 lg:bg-paper relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="w-full max-w-md"
        >
          <div className="bg-paper/95 backdrop-blur-sm rounded-card p-6 sm:p-8 lg:bg-transparent lg:backdrop-blur-none lg:rounded-none lg:p-0">
            <header className="mb-8 lg:mb-10">
              <p className="type-label text-mute uppercase">Sign In</p>
              <h1 className="mt-4 type-headline text-ink-deep">
                Pick up where<br className="hidden sm:inline" />
                <span className="text-ink-soft"> you left off.</span>
              </h1>
              <p className="mt-4 text-[15px] text-body leading-relaxed max-w-sm">
                Sign in to continue your career journey.
              </p>
            </header>

            <div className="space-y-6">
              <ClerkCaptcha />

              <GoogleButton
                onClick={handleGoogleSignIn}
                disabled={isGoogleLoading || isLoading}
                isLoading={isGoogleLoading}
                className="w-full"
              />

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-hairline" />
                <span className="type-label text-mute uppercase">
                  Or continue with
                </span>
                <span className="h-px flex-1 bg-hairline" />
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="rounded-control border border-state-error/30 bg-state-error/10 p-3"
                  role="alert"
                >
                  <p className="text-sm text-state-error">{error}</p>
                </motion.div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label
                    htmlFor="email"
                    className="text-[13px] text-body mb-2 block"
                  >
                    Email
                  </label>
                  <div
                    className={cn(
                      "border-b transition-colors duration-300",
                      emailFocused ? "border-ink/40" : "border-hairline"
                    )}
                  >
                    <input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="you@example.com"
                      value={formData.email}
                      onChange={handleInputChange}
                      onFocus={() => setEmailFocused(true)}
                      onBlur={() => setEmailFocused(false)}
                      disabled={isLoading}
                      autoComplete="email"
                      required
                      className="w-full bg-transparent py-3 text-[15px] text-ink-deep placeholder:text-mute focus:outline-none disabled:opacity-50"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="text-[13px] text-body mb-2 block"
                  >
                    Password
                  </label>
                  <div
                    className={cn(
                      "border-b transition-colors duration-300 relative",
                      passwordFocused ? "border-ink/40" : "border-hairline"
                    )}
                  >
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={formData.password}
                      onChange={handleInputChange}
                      onFocus={() => setPasswordFocused(true)}
                      onBlur={() => setPasswordFocused(false)}
                      disabled={isLoading}
                      autoComplete="current-password"
                      required
                      className="w-full bg-transparent py-3 pr-10 text-[15px] text-ink-deep placeholder:text-mute focus:outline-none disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={isLoading}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-0 top-1/2 -translate-y-1/2 text-mute hover:text-ink transition-colors duration-300"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Link
                    href="/forgot-password"
                    className="text-[13px] text-body hover:text-ink transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>

                <button
                  type="submit"
                  disabled={
                    isLoading ||
                    isGoogleLoading ||
                    !formData.email ||
                    !formData.password
                  }
                  className="inline-flex w-full h-12 items-center justify-center rounded-pill bg-ink px-6 text-[15px] font-medium text-paper transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    "Sign In"
                  )}
                </button>
              </form>

              <p className="text-[13px] text-body">
                Don&rsquo;t have an account?{" "}
                <Link
                  href="/sign-up"
                  className="font-medium text-ink hover:underline"
                >
                  Sign up
                </Link>
              </p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Right-side illustration (desktop) */}
      <div className="hidden lg:flex flex-1 relative overflow-hidden min-h-screen">
        <Image
          src="/sign-in.svg"
          alt="Career progression illustration"
          fill
          priority
          sizes="50vw"
          className="object-cover animate-in fade-in duration-1000"
        />
      </div>
    </div>
  );
}
