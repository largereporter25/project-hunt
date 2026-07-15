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
    case "mca21":
    case "nse_bse":
      return Briefcase;
    case "indian_kanoon":
    case "ecourts":
      return Gavel;
    default:
      return FileText;
  }
}
