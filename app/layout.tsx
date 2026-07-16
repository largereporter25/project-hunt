import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "project hunt // osint workstation",
  description: "Unified OSINT orchestration with cryptographic provenance.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
