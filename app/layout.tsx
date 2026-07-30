import type { Metadata } from "next";
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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
