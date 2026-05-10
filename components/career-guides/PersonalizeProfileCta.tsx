import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

const eyebrowCls =
  "text-[10px] uppercase tracking-[0.18em] font-medium text-mute";

type Props = {
  /** Optional context-aware copy. Defaults to a generic prompt. */
  guideTitle?: string;
  /** Optional DOM id so the section can be a TOC scroll target. */
  id?: string;
};

export function PersonalizeProfileCta({ guideTitle, id }: Props) {
  const headline = guideTitle
    ? `See how you stack up against this ${guideTitle.toLowerCase()} role.`
    : "See how this career fits you.";

  return (
    <section
      id={id}
      className="scroll-mt-24 border-t border-hairline py-14 first:border-t-0 first:pt-0"
    >
      <div className="flex items-center gap-2">
        <p className={eyebrowCls}>Personalise this guide</p>
      </div>
      <h2 className="mt-3 max-w-2xl text-balance text-3xl leading-[1.15] tracking-tight text-ink [font-family:var(--font-serif)] sm:text-[2rem]">
        {headline}
      </h2>
      <p className="mt-4 max-w-xl text-[16px] leading-[1.7] text-ink/70">
        Upload your CV and we'll show you exactly where you stand, the skills
        you already bring, what travels with you, and the ground you'd need to
        make up.
      </p>
      <Link
        href="/workspace/profile"
        className="mt-7 inline-flex items-center gap-2 rounded-pill bg-ink px-5 py-2.5 text-[14px] font-medium text-paper transition-colors hover:bg-ink/90"
      >
        <Sparkles className="h-4 w-4" />
        Add your profile
        <ArrowRight className="h-4 w-4" />
      </Link>
    </section>
  );
}
