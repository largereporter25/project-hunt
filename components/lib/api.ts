/**
 * Thin API client for the Project HUNT backend.
 *
 *   /api/v1/hunt          — POST  investigate a target
 *   /api/v1/findings      — GET   recent findings
 *   /api/v1/graph         — GET   live entity graph
 *   /api/v1/vault/{id}    — GET   evidence record (+ raw payload)
 *   /api/v1/vault         — GET   recent evidence records
 *   /api/v1/modules       — GET   list of OSINT modules
 *   /api/v1/stats         — GET   aggregate counters
 *
 * The browser reads the backend base URL from the build-time env var
 * ``NEXT_PUBLIC_API_URL``. In production (Vercel), set that to your
 * Railway/Render backend URL. In dev, leave it unset and the client
 * falls back to http://localhost:8000 so the local FastAPI process
 * still works without any env file.
 *
 * Next.js inlines ``NEXT_PUBLIC_*`` at build time, so this constant
 * is a plain string in the browser bundle.
 */

import type {
  EvidenceRecord,
  Finding,
  GraphSnapshot,
  HuntResponse,
  InvestigationSummary,
  InvestigationDetail,
  ModuleInfo,
  Stats,
} from "./types";

const RAW_BASE =
  typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL
    : "http://localhost:8000";

// Strip any trailing slash so concatenation is unambiguous, then
// append the versioned API prefix exactly once.
const BASE = `${RAW_BASE.replace(/\/+$/, "")}/api/v1`;

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body && typeof body === "object" && "detail" in body) {
        detail = String((body as { detail: unknown }).detail);
      }
    } catch {
      // body wasn't JSON; keep the status text.
    }
    throw new Error(`API ${path} failed: ${detail}`);
  }
  return (await res.json()) as T;
}

export const api = {
  modules: () => request<ModuleInfo[]>(`/modules`),
  hunt: (body: {
    target: string;
    kind?: string | null;
    modules?: string[] | null;
  }) =>
    request<HuntResponse>(`/hunt`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  findings: (limit = 200) => request<Finding[]>(`/findings?limit=${limit}`),
  investigations: (limit = 20) =>
    request<InvestigationSummary[]>(`/investigations?limit=${limit}`),
  investigation: (id: string) =>
    request<InvestigationDetail>(`/investigations/${id}`),
  graph: () => request<GraphSnapshot>(`/graph`),
  vault: (evidenceId: string, includePayload = true) =>
    request<EvidenceRecord>(
      `/vault/${evidenceId}?include_payload=${includePayload ? "true" : "false"}`
    ),
  vaultRecent: (limit = 50) => request<EvidenceRecord[]>(`/vault?limit=${limit}`),
  stats: () => request<Stats>(`/stats`),
  summarize: (body: { target: string; findings: Finding[]; question?: string }) =>
    request<{ summary: string; model: string }>(`/summarize`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  exportUrl: (investigationId?: string) =>
    investigationId
      ? `${BASE}/export?investigation_id=${encodeURIComponent(investigationId)}`
      : `${BASE}/export`,
};
