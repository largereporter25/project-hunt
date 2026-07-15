import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project HUNT — OSINT Workstation",
  description:
    "Unified OSINT orchestration with cryptographic provenance and live entity correlation.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-screen bg-slate-950 text-slate-300 antialiased">
        {children}
      </body>
    </html>
  );
}
