"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useSignUp } from "@clerk/nextjs/legacy";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { ClerkCaptcha } from "@/components/auth/ClerkCaptcha";
import { GoogleButton } from "@/components/auth/GoogleButton";

const ease = [0.2, 0.65, 0.3, 1] as const;
const eyebrow = "type-label text-mute uppercase";

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

interface PasswordRequirement {
  met: boolean;
  text: string;
}

export function SignUpForm() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const router = useRouter();

  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");

  const [firstNameFocused, setFirstNameFocused] = useState(false);
  const [lastNameFocused, setLastNameFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);

  const passwordRequirements: PasswordRequirement[] = [
    { met: formData.password.length >= 8, text: "At least 8 characters" },
    { met: /[A-Z]/.test(formData.password), text: "One uppercase letter" },
    { met: /[a-z]/.test(formData.password), text: "One lowercase letter" },
    { met: /\d/.test(formData.password), text: "One number" },
  ];
  const isPasswordValid = passwordRequirements.every((r) => r.met);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setError(null);
  };

  const errorMessage = (err: unknown, fallback: string) =>
    (err as { errors?: Array<{ message?: string }>; message?: string })
      ?.errors?.[0]?.message ??
    (err as { message?: string })?.message ??
    fallback;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded) return;

    setIsLoading(true);
    setError(null);

    try {
      await signUp.create({
        firstName: formData.firstName,
        lastName: formData.lastName,
        emailAddress: formData.email,
        password: formData.password,
      });

      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setIsVerifying(true);
    } catch (err: unknown) {
      setError(errorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoaded) return;

    setIsLoading(true);
    setError(null);

    try {
      const completeSignUp = await signUp.attemptEmailAddressVerification({
        code: verificationCode,
      });

      if (completeSignUp.status === "complete") {
        await setActive({ session: completeSignUp.createdSessionId });
        router.push("/workspace/profile");
      } else {
        setError("Verification incomplete. Please try again.");
      }
    } catch (err: unknown) {
      setError(errorMessage(err, "Invalid verification code. Please try again."));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    if (!isLoaded) return;

    setIsGoogleLoading(true);
    setError(null);

    try {
      await signUp.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        redirectUrlComplete: "/workspace/profile",
      });
    } catch {
      setError("Failed to sign up with Google. Please try again.");
      setIsGoogleLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!isLoaded) return;
    setError(null);
    setInfo(null);
    try {
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setInfo("Verification code resent.");
    } catch (err: unknown) {
      setError(errorMessage(err, "Failed to resend code."));
    }
  };

  // Verification step
  if (isVerifying) {
    return (
      <div className="min-h-screen flex flex-col lg:flex-row relative bg-paper">
        <div className="absolute inset-0 lg:hidden">
          <Image
            src="/sign-up.svg"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover animate-in fade-in duration-1000"
          />
        </div>

        <div className="flex-1 flex items-center justify-center p-6 sm:p-8 lg:p-12 lg:bg-paper relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease }}
            className="w-full max-w-md"
          >
            <div className="bg-paper/95 backdrop-blur-sm rounded-card p-6 sm:p-8 lg:bg-transparent lg:backdrop-blur-none lg:rounded-none lg:p-0">
              <header className="mb-8 lg:mb-10">
                <p className={eyebrow}>Verify Email</p>
                <h1 className="mt-4 type-headline text-ink-deep">
                  Check your<br className="hidden sm:inline" />
                  <span className="text-ink-soft"> inbox.</span>
                </h1>
                <p className="mt-4 text-[15px] text-body leading-relaxed">
                  We sent a code to{" "}
                  <span className="font-medium text-ink-deep">
                    {formData.email}
                  </span>
                </p>
              </header>

              <div className="space-y-6">
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
                {info && !error && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="rounded-control border border-state-success/30 bg-state-success/10 p-3"
                  >
                    <p className="text-sm text-state-success">{info}</p>
                  </motion.div>
                )}

                <form onSubmit={handleVerification} className="space-y-5">
                  <div>
                    <label
                      htmlFor="verification-code"
                      className="text-[13px] text-body mb-2 block"
                    >
                      Verification code
                    </label>
                    <div
                      className={cn(
                        "border-b transition-colors duration-300",
                        codeFocused ? "border-ink/40" : "border-hairline"
                      )}
                    >
                      <input
                        id="verification-code"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="Enter 6-digit code"
                        value={verificationCode}
                        onChange={(e) => setVerificationCode(e.target.value)}
                        onFocus={() => setCodeFocused(true)}
                        onBlur={() => setCodeFocused(false)}
                        disabled={isLoading}
                        maxLength={6}
                        required
                        className="w-full bg-transparent py-2.5 text-center text-lg tracking-wider text-ink-deep placeholder:text-mute focus:outline-none disabled:opacity-50"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading || verificationCode.length !== 6}
                    className="inline-flex w-full h-12 items-center justify-center rounded-pill bg-ink px-6 text-[15px] font-medium text-paper transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      "Verify Email"
                    )}
                  </button>
                </form>

                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setIsVerifying(false);
                      setInfo(null);
                      setError(null);
                    }}
                    className="text-[13px] text-body hover:text-ink transition-colors"
                  >
                    Back to sign up
                  </button>
                  <button
                    type="button"
                    onClick={handleResendCode}
                    className="text-[13px] text-body hover:text-ink transition-colors"
                  >
                    Resend code
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        <div className="hidden lg:flex flex-1 relative overflow-hidden min-h-screen">
          <Image
            src="/sign-up.svg"
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

  // Main sign-up step
  return (
    <div className="min-h-screen flex flex-col lg:flex-row relative bg-paper">
      <div className="absolute inset-0 lg:hidden">
        <Image
          src="/sign-up.svg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover animate-in fade-in duration-1000"
        />
      </div>

      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 lg:p-12 lg:bg-paper relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          className="w-full max-w-md"
        >
          <div className="bg-paper/95 backdrop-blur-sm rounded-card p-6 sm:p-8 lg:bg-transparent lg:backdrop-blur-none lg:rounded-none lg:p-0">
            <header className="mb-8 lg:mb-10">
              <p className={eyebrow}>Create Account</p>
              <h1 className="mt-4 type-headline text-ink-deep">
                Start your<br className="hidden sm:inline" />
                <span className="text-ink-soft"> career journey.</span>
              </h1>
              <p className="mt-4 text-[15px] text-body leading-relaxed max-w-sm">
                Set up your account and discover where your career could take
                you.
              </p>
            </header>

            <div className="space-y-6">
              <ClerkCaptcha />

              <GoogleButton
                onClick={handleGoogleSignUp}
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
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="firstName"
                      className="text-[13px] text-body mb-2 block"
                    >
                      First name
                    </label>
                    <div
                      className={cn(
                        "border-b transition-colors duration-300",
                        firstNameFocused ? "border-ink/40" : "border-hairline"
                      )}
                    >
                      <input
                        id="firstName"
                        name="firstName"
                        type="text"
                        placeholder="Jamie"
                        value={formData.firstName}
                        onChange={handleInputChange}
                        onFocus={() => setFirstNameFocused(true)}
                        onBlur={() => setFirstNameFocused(false)}
                        disabled={isLoading}
                        autoComplete="given-name"
                        required
                        className="w-full bg-transparent py-3 text-[15px] text-ink-deep placeholder:text-mute focus:outline-none disabled:opacity-50"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="lastName"
                      className="text-[13px] text-body mb-2 block"
                    >
                      Last name
                    </label>
                    <div
                      className={cn(
                        "border-b transition-colors duration-300",
                        lastNameFocused ? "border-ink/40" : "border-hairline"
                      )}
                    >
                      <input
                        id="lastName"
                        name="lastName"
                        type="text"
                        placeholder="Lee"
                        value={formData.lastName}
                        onChange={handleInputChange}
                        onFocus={() => setLastNameFocused(true)}
                        onBlur={() => setLastNameFocused(false)}
                        disabled={isLoading}
                        autoComplete="family-name"
                        required
                        className="w-full bg-transparent py-3 text-[15px] text-ink-deep placeholder:text-mute focus:outline-none disabled:opacity-50"
                      />
                    </div>
                  </div>
                </div>

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
                      "border-b transition-colors duration-300 flex items-center",
                      passwordFocused ? "border-ink/40" : "border-hairline"
                    )}
                  >
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Create a strong password"
                      value={formData.password}
                      onChange={handleInputChange}
                      onFocus={() => setPasswordFocused(true)}
                      onBlur={() => setPasswordFocused(false)}
                      disabled={isLoading}
                      autoComplete="new-password"
                      required
                      className="w-full bg-transparent py-3 text-[15px] text-ink-deep placeholder:text-mute focus:outline-none disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={isLoading}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="ml-2 text-mute hover:text-ink transition-colors shrink-0"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {formData.password && (
                    <div className="mt-3 space-y-1.5">
                      {passwordRequirements.map((req, i) => (
                        <p
                          key={i}
                          className={cn(
                            "text-[12px] transition-colors duration-300",
                            req.met ? "text-mute" : "text-body"
                          )}
                        >
                          <span
                            className={cn(
                              "inline-block w-1 h-1 rounded-full mr-2 align-middle transition-colors duration-300",
                              req.met ? "bg-state-success" : "bg-hairline-strong"
                            )}
                          />
                          {req.text}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={
                    isLoading ||
                    isGoogleLoading ||
                    !formData.firstName ||
                    !formData.lastName ||
                    !formData.email ||
                    !isPasswordValid
                  }
                  className="inline-flex w-full h-12 items-center justify-center rounded-pill bg-ink px-6 text-[15px] font-medium text-paper transition-colors hover:bg-ink-deep disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    "Create Account"
                  )}
                </button>
              </form>

              <div className="space-y-3">
                <p className="text-[12px] text-mute">
                  By creating an account, you agree to our{" "}
                  <Link
                    href="/terms"
                    className="underline hover:text-ink transition-colors"
                  >
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link
                    href="/privacy"
                    className="underline hover:text-ink transition-colors"
                  >
                    Privacy Policy
                  </Link>
                  .
                </p>

                <p className="text-[13px] text-body">
                  Already have an account?{" "}
                  <Link
                    href="/sign-in"
                    className="font-medium text-ink hover:underline"
                  >
                    Sign in
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="hidden lg:flex flex-1 relative overflow-hidden min-h-screen">
        <Image
          src="/sign-up.svg"
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
