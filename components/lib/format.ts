/**
 * Forensic helpers used across the dashboard:
 *   * shortSha — first 12 hex chars of a SHA-256 (analyst-friendly)
 *   * fmtTs    — render an ISO timestamp as a terminal-style timestamp
 *   * detectKind — quick heuristic to pick a target kind before sending
 *   * iconForKind — map an entity kind to a Lucide icon name
 */

import {
  Globe,
  Server,
  AtSign,
  Phone,
  User,
  Building2,
  Shield,
  Network,
  Link2,
  Hash,
  AlertOctagon,
  FileText,
  Briefcase,
  Gavel,
  Quote,
  CircleHelp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { EntityKind } from "./types";

export function shortSha(sha: string): string {
  if (!sha || sha.length < 12) return sha || "—";
  return `${sha.slice(0, 12)}…${sha.slice(-4)}`;
}

export function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    // YYYY-MM-DD HH:MM:SSZ — terminal style, no locale string.
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
    );
  } catch {
    return iso;
  }
}

const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9()\-\s]{7,}$/;

export type InferredKind =
  | "ipv4"
  | "ipv6"
  | "email"
  | "phone"
  | "domain"
  | "unknown";

export function detectKind(target: string): InferredKind {
  const t = target.trim();
  if (!t) return "unknown";
  if (IPV4_RE.test(t)) return "ipv4";
  if (t.includes("@") && EMAIL_RE.test(t)) return "email";
  if (t.startsWith("+") || (PHONE_RE.test(t) && t.replace(/\D/g, "").length >= 7))
    return "phone";
  if (t.includes(".") && !t.includes(" ")) return "domain";
  if (t.includes(":") && IPV6_RE.test(t)) return "ipv6";
  return "unknown";
}

export function iconForKind(kind: EntityKind): LucideIcon {
  switch (kind) {
    case "ipv4":
    case "ipv6":
      return Server;
    case "email":
      return AtSign;
    case "phone":
      return Phone;
    case "person":
      return User;
    case "org":
      return Building2;
    case "cert":
      return Shield;
    case "asn":
      return Network;
    case "url":
      return Link2;
    case "hash":
      return Hash;
    case "breach":
      return AlertOctagon;
    case "domain":
    case "subdomain":
      return Globe;
    case "company_registration":
      return Briefcase;
    case "court_case":
      return Gavel;
    case "claim":
      return Quote;
    case "username":
      return User;
    default:
      return CircleHelp;
  }
}

export function iconForTool(tool: string): LucideIcon {
  switch (tool) {
    case "shodan":
    case "ipinfo":
    case "greynoise":
      return Server;
    case "whois":
      return Building2;
    case "dns":
      return Network;
    case "crt_sh":
      return Shield;
    case "wayback_cdx":
      return Globe;
    case "virustotal":
    case "hibp":
      return AlertOctagon;
    case "factcheck":
      return Quote;
    case "indian_kanoon":
    case "ecourts":
      return Gavel;
    case "tafcop":
      return Phone;
    case "myneta_adr":
      return Briefcase;
    default:
      return FileText;
  }
}

// Per-kind accent colors. The graph and the findings table use these to
// make cross-source pivots visually pop. Keep the palette muted — this
// is an analyst tool, not a marketing site.
export function accentForKind(kind: EntityKind): {
  text: string; // tailwind text-*
  border: string; // tailwind border-*
  bg: string; // tailwind bg-*
  hex: string; // raw hex, useful for inline styles (reactflow, svg)
} {
  switch (kind) {
    case "ipv4":
    case "ipv6":
      return {
        text: "text-amber-300",
        border: "border-amber-700/50",
        bg: "bg-amber-950/30",
        hex: "#fbbf24",
      };
    case "domain":
    case "subdomain":
      return {
        text: "text-indigo-300",
        border: "border-indigo-700/50",
        bg: "bg-indigo-950/30",
        hex: "#a5b4fc",
      };
    case "email":
      return {
        text: "text-rose-300",
        border: "border-rose-700/50",
        bg: "bg-rose-950/30",
        hex: "#fda4af",
      };
    case "phone":
      return {
        text: "text-orange-300",
        border: "border-orange-700/50",
        bg: "bg-orange-950/30",
        hex: "#fdba74",
      };
    case "person":
      return {
        text: "text-emerald-300",
        border: "border-emerald-700/50",
        bg: "bg-emerald-950/30",
        hex: "#6ee7b7",
      };
    case "org":
      return {
        text: "text-sky-300",
        border: "border-sky-700/50",
        bg: "bg-sky-950/30",
        hex: "#7dd3fc",
      };
    case "cert":
      return {
        text: "text-purple-300",
        border: "border-purple-700/50",
        bg: "bg-purple-950/30",
        hex: "#d8b4fe",
      };
    case "asn":
      return {
        text: "text-cyan-300",
        border: "border-cyan-700/50",
        bg: "bg-cyan-950/30",
        hex: "#67e8f9",
      };
    case "url":
      return {
        text: "text-cyan-200",
        border: "border-cyan-800/50",
        bg: "bg-cyan-950/20",
        hex: "#a5f3fc",
      };
    case "hash":
      return {
        text: "text-slate-300",
        border: "border-slate-700/60",
        bg: "bg-slate-900/40",
        hex: "#cbd5e1",
      };
    case "breach":
      return {
        text: "text-rose-200",
        border: "border-rose-800/60",
        bg: "bg-rose-950/40",
        hex: "#fecaca",
      };
    case "company_registration":
      return {
        text: "text-yellow-300",
        border: "border-yellow-700/50",
        bg: "bg-yellow-950/30",
        hex: "#fde047",
      };
    case "court_case":
      return {
        text: "text-fuchsia-300",
        border: "border-fuchsia-700/50",
        bg: "bg-fuchsia-950/30",
        hex: "#f0abfc",
      };
    case "claim":
      return {
        text: "text-teal-300",
        border: "border-teal-700/50",
        bg: "bg-teal-950/30",
        hex: "#5eead4",
      };
    case "username":
      return {
        text: "text-emerald-200",
        border: "border-emerald-800/50",
        bg: "bg-emerald-950/20",
        hex: "#a7f3d0",
      };
    default:
      return {
        text: "text-slate-300",
        border: "border-slate-700/60",
        bg: "bg-slate-900/40",
        hex: "#94a3b8",
      };
  }
}
