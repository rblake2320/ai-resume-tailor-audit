import type { Metadata } from "next";
import { connection } from "next/server";
import { headers } from "next/headers";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/instrument-sans";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import "./globals.css";
import { PilotProvider } from "@/components/PilotPanel";

export const metadata: Metadata = {
  title: "Resume Foundry — honest AI resume tailoring",
  description:
    "Tailor evidence-linked resumes and cover letters, review changes, and export DOCX. Private browser profiles with explicit optional sharing.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Nonce-bearing CSP requires per-request rendering so Next can attach the
  // request nonce to its framework and page scripts.
  await connection();
  const pilot = process.env.RESUME_FOUNDRY_PILOT_MODE === "true";
  const participant = pilot ? (await headers()).get("x-resume-pilot-participant") ?? "" : "";
  return (
    <html lang="en" data-pilot-mode={pilot ? "true" : undefined} data-pilot-participant={participant || undefined}>
      <body className="min-h-screen antialiased"><PilotProvider enabled={process.env.RESUME_FOUNDRY_PILOT_MODE === "true"} aiEnabled={process.env.RESUME_FOUNDRY_PILOT_AI_ENABLED === "true"}>{children}</PilotProvider></body>
    </html>
  );
}
