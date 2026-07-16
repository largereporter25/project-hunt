/**
 * Tiny text-rendering helpers used by the single-pane terminal UI.
 *
 * The UI dumps raw text into a <pre>, so the "format" we apply is
 * just: monospace alignment via fixed widths, ISO timestamps, and
 * short SHA prefixes. Nothing else — no colors, no chips.
 */

export function fmtTs(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  // YYYY-MM-DD HH:MM:SSZ — same shape as the previous UI used.
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
  );
}

export function shortSha(s: string | null | undefined, n = 12): string {
  if (!s) return "—";
  return s.slice(0, n);
}

export function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

export function banner(label: string, width = 60): string {
  const line = "─".repeat(width);
  return `${line}\n${label}\n${line}`;
}

export function divider(width = 60): string {
  return "─".repeat(width);
}
