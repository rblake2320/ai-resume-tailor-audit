import type { Metadata } from "next";
import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";

export const metadata: Metadata = {
  title: "About Resume Foundry",
  description: "Resume Foundry's purpose, principles, privacy boundary, and current product limits.",
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-8 md:px-8">
      <SiteNav current="/about" />
      <main>
        <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-brass-400">Built around evidence, agency, and durable career memory</p>
        <h1 className="mt-3 font-display text-4xl font-semibold text-paper md:text-5xl">About Resume Foundry</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-ink-300">
          Resume Foundry is a candidate-controlled workspace for preserving career evidence, understanding opportunities, tailoring honest application materials, and remembering what was sent where.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <section className="rounded-xl border border-ink-700 bg-ink-900/70 p-5">
            <h2 className="font-display text-xl font-semibold text-paper">Evidence before polish</h2>
            <p className="mt-2 text-sm leading-6 text-ink-300">A stronger sentence is useful only when the underlying experience supports it. Unsupported requirements remain visible instead of being fabricated.</p>
          </section>
          <section className="rounded-xl border border-ink-700 bg-ink-900/70 p-5">
            <h2 className="font-display text-xl font-semibold text-paper">The candidate stays in control</h2>
            <p className="mt-2 text-sm leading-6 text-ink-300">Privacy modes, manual editing, approvals, exports, deletion, and recovery are user choices—not hidden automation.</p>
          </section>
          <section className="rounded-xl border border-ink-700 bg-ink-900/70 p-5">
            <h2 className="font-display text-xl font-semibold text-paper">A career is bigger than a resume</h2>
            <p className="mt-2 text-sm leading-6 text-ink-300">The Career Ledger preserves projects, learning, work, and verified evidence so today’s overlooked experience can become tomorrow’s relevant proof.</p>
          </section>
        </div>

        <section className="mt-10 space-y-3 border-t border-ink-700 pt-8" aria-labelledby="privacy-heading">
          <h2 id="privacy-heading" className="font-display text-2xl font-semibold text-paper">Privacy and operating boundary</h2>
          <p className="max-w-3xl text-sm leading-6 text-ink-300">
            The workshop profile, active session, save points, and run history are browser-local. Tailoring sends the selected resume and job text to the deployment’s configured Anthropic API. Optional integrations have their own explicit configuration and consent boundaries. Browser storage is convenient, but long-term records should also be exported and backed up by the user.
          </p>
        </section>

        <section className="mt-8 space-y-3 border-t border-ink-700 pt-8" aria-labelledby="status-heading">
          <h2 id="status-heading" className="font-display text-2xl font-semibold text-paper">Current status</h2>
          <p className="max-w-3xl text-sm leading-6 text-ink-300">
            The repository is a tested reference implementation suitable for local and controlled demonstrations. Real employer submission, public multi-user hosting, external credential interoperability, and regulated production use require separate deployment controls, partner authorization, operational readiness, and independent review.
          </p>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/" className="rounded-lg bg-brass-400 px-5 py-3 text-sm font-semibold text-ink-950">Open the workshop</Link>
          <Link href="/how-it-works" className="rounded-lg border border-ink-600 px-5 py-3 text-sm font-semibold text-paper hover:bg-ink-800">See how it works</Link>
        </div>
      </main>
    </div>
  );
}
