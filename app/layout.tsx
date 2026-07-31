import type { Metadata } from "next";
import { connection } from "next/server";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/instrument-sans";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resume Foundry — honest AI resume tailoring",
  description:
    "Save your career profile once, then tailor an honest, ATS-safe resume and cover letter for any job posting. Transparent scoring, full change diff, DOCX export, and nothing stored server-side.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Nonce-bearing CSP requires per-request rendering so Next can attach the
  // request nonce to its framework and page scripts.
  await connection();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
