import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create your account",
  description:
    "Set up your Career Steer account and discover where your career could take you.",
};

export default function SignUpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
