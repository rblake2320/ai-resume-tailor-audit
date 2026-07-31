import Link from "next/link";

const links = [
  { href: "/", label: "Workshop" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/about", label: "About" },
] as const;

export function SiteNav({ current }: { current: (typeof links)[number]["href"] }) {
  return (
    <nav aria-label="Primary navigation" className="mb-8 flex flex-wrap items-center gap-2 border-b border-ink-700 pb-4">
      <Link href="/" className="mr-auto font-display text-xl font-semibold text-paper">
        Resume <em className="text-brass-300">Foundry</em>
      </Link>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={current === link.href ? "page" : undefined}
          className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
            current === link.href
              ? "bg-brass-400/15 text-brass-300"
              : "text-ink-300 hover:bg-ink-800 hover:text-paper"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
