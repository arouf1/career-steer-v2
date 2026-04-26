import { ArrowRight, FileText, IdCard, UploadCloud } from "lucide-react";
import { SiteNav } from "@/components/site/SiteNav";

export default function Home() {
  return (
    <>
      <SiteNav />
      <main className="flex flex-1 flex-col">
        <section className="border-b border-hairline">
          <div className="mx-auto grid max-w-6xl gap-12 px-6 py-20 md:grid-cols-2 md:gap-16 md:py-28">
            <div className="flex flex-col gap-10">
              <h1 className="type-display text-ink">
                Where could{" "}
                <span className="text-ink-soft">your</span>{" "}
                <span className="text-ink-soft">career</span> take you?
              </h1>

              <p className="type-body-lg text-body max-w-prose">
                Career transitions can feel uncertain. Share your background and
                we&rsquo;ll map out paths that match your experience, interests,
                and ambitions, then help you get there.
              </p>

              <ul className="flex flex-col gap-4 max-w-prose">
                {[
                  "AI-powered path matching based on your real experience",
                  "Personalised roadmaps with actionable next steps",
                  "Your data stays private and confidential",
                ].map((item) => (
                  <li key={item} className="relative pl-4 type-body text-body">
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-2.5 h-3 w-px bg-hairline-strong"
                    />
                    {item}
                  </li>
                ))}
              </ul>

              <a
                href="#features"
                className="type-label inline-flex items-center gap-2 self-start text-ink transition-colors hover:text-ink-deep"
              >
                See all features
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>

            <div className="flex items-start">
              <UploadPreview />
            </div>
          </div>
        </section>

        <section
          id="features"
          className="mx-auto w-full max-w-6xl px-6 py-16"
        >
          <p className="type-caption text-mute max-w-prose">
            Your CV is analysed locally and never stored unless you create an
            account. We use AI to understand your experience, not to collect
            your data.
          </p>
        </section>
      </main>
    </>
  );
}

function UploadPreview() {
  return (
    <article className="w-full rounded-card border border-hairline bg-paper-raised p-6 sm:p-8">
      <div className="mb-8 inline-flex w-full items-center gap-1 rounded-pill border border-hairline bg-paper p-1">
        <span className="type-label inline-flex flex-1 items-center justify-center gap-2 rounded-pill bg-paper-raised px-4 py-2.5 text-ink">
          <FileText className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          Upload CV
        </span>
        <span className="type-label inline-flex flex-1 items-center justify-center gap-2 rounded-pill px-4 py-2.5 text-mute">
          <IdCard className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          LinkedIn
        </span>
      </div>

      <div className="rounded-card border border-dashed border-hairline-strong bg-paper px-6 py-12 text-center">
        <UploadCloud
          className="mx-auto mb-4 h-8 w-8 text-mute"
          aria-hidden="true"
          strokeWidth={1.25}
        />
        <h3 className="type-title text-ink">
          CV or career profile screenshots
        </h3>
        <p className="type-body mt-2 text-body max-w-sm mx-auto">
          Drop your CV here and we&rsquo;ll explore what&rsquo;s possible.
        </p>
        <p className="type-caption mt-6 text-mute">
          Supports PDF, DOCX, and image screenshots.
        </p>
      </div>
    </article>
  );
}
