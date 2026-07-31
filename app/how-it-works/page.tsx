import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";

export const metadata: Metadata = {
  title: "How Resume Foundry works",
  description: "A practical guide to building a profile, importing a job, protecting personal information, tailoring documents, and tracking applications.",
};

const steps = [
  ["Build your evidence base", "Paste or upload your master resume and add useful background. Resume Foundry saves this working profile in your browser and never invents missing experience."],
  ["Bring in a real job", "Paste a posting, import supported job data, or fetch an allowed public job URL. Review the title, employer, requirements, and source before using it."],
  ["Choose your privacy level", "Protect mode masks detected personal details before generation and restores them locally afterward. Review mode shows detections first. Exact mode sends the text you entered."],
  ["Forge and review", "The configured Anthropic model drafts an evidence-linked resume and cover letter. Inspect the requirement map, unsupported gaps, wording changes, and ATS checks before accepting anything."],
  ["Export and track", "Download or copy the reviewed documents, preserve the exact application packet, and record submission, interview, offer, rejection, and follow-up events."],
  ["Keep the long view", "Save points protect active work. The encrypted Career Ledger can retain projects, learning, work, and attestations that may become relevant years later."],
] as const;

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 md:px-8">
      <SiteNav current="/how-it-works" />
      <main>
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-brass-400">From source evidence to reviewed application</p>
        <h1 className="mt-3 font-display text-4xl font-semibold text-paper md:text-5xl">How it works</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-ink-300">
          Resume Foundry helps you tailor and organize your work without turning AI output into an unchecked claim. You remain the final reviewer and nothing is submitted to an employer without an explicit approval flow.
        </p>

        <ol className="mt-10 grid gap-4 md:grid-cols-2">
          {steps.map(([title, body], index) => (
            <li key={title} className="rounded-xl border border-ink-700 bg-ink-900/70 p-5">
              <p className="font-mono text-[10px] uppercase tracking-widest text-brass-400">Step {String(index + 1).padStart(2, "0")}</p>
              <h2 className="mt-2 font-display text-xl font-semibold text-paper">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-ink-300">{body}</p>
            </li>
          ))}
        </ol>

        <section className="mt-10 rounded-xl border border-brass-400/30 bg-brass-400/10 p-6" aria-labelledby="limits-heading">
          <h2 id="limits-heading" className="font-display text-2xl font-semibold text-paper">What the tool does not decide for you</h2>
          <p className="mt-3 text-sm leading-6 text-ink-300">
            Match scores are decision support, not hiring predictions. Labor-market projections are not guarantees. Generated documents still require human review. Employer submissions and connected services work only when their separate credentials, approvals, and safeguards are configured.
          </p>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/" className="rounded-lg bg-brass-400 px-5 py-3 text-sm font-semibold text-ink-950">Open the workshop</Link>
          <Link href="/about" className="rounded-lg border border-ink-600 px-5 py-3 text-sm font-semibold text-paper hover:bg-ink-800">Read about the project</Link>
        </div>
      </main>
    </div>
  );
}
