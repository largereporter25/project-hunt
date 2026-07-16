/**
 * Best-effort kind detection for a target string.
 *
 * Mirrors the Python `_tools_for_target` heuristic exactly. Used by
 * the `/api/hunt` route to narrow the set of tools to run when the
 * caller does not pass an explicit `kind` or `modules` list.
 */

export type Kind =
  | "domain"
  | "ipv4"
  | "ipv6"
  | "url"
  | "email"
  | "phone"
  | "person"
  | "org"
  | "claim"
  | "court_case"
  | "company_registration"
  | "hash"
  | "username";

export function looksLikeIpv4(s: string): boolean {
  const parts = s.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

export function looksLikeIpv6(s: string): boolean {
  return (
    (s.includes(":") && s.includes(".")) ||
    (s.split(":").length >= 3 && /^[0-9a-fA-F:]+$/.test(s))
  );
}

export function inferKind(target: string): Kind | null {
  const t = (target ?? "").trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return "url";
  if (t.includes("@")) return "email";
  if (looksLikeIpv4(t)) return "ipv4";
  if (looksLikeIpv6(t)) return "ipv6";
  const digits = t.replace(/^\+/, "");
  if (/^\d+$/.test(digits) && digits.length >= 7 && digits.length <= 15) {
    return "phone";
  }
  if (lower.includes(".") && !lower.includes(" ") && !lower.includes("/")) {
    return "domain";
  }
  return "person";
}
