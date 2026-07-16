/**
 * Wayback Machine CDX API.
 *
 * Lists every archived snapshot of a domain. No API key.
 */

import { ToolFunction, type FetchResult, type Finding } from "./base";

export class WaybackTool extends ToolFunction {
  readonly name = "wayback_cdx";
  readonly accepts = new Set(["domain", "url", "person", "org"]);
  readonly emits = new Set(["url"]);
  readonly docs_url = "https://web.archive.org/cdx/";
  readonly description = "Archive.org Wayback CDX — historic URL snapshots.";
  readonly per_request_timeout_ms = 15_000;

  private static URL = "https://web.archive.org/cdx/search/cdx";

  protected async _fetch(query: { target: string }): Promise<FetchResult> {
    const target = (query.target || "").trim().toLowerCase();
    const match = target.includes(".") ? `*.${target}` : target;
    const url = new URL(WaybackTool.URL);
    url.searchParams.set("url", match);
    url.searchParams.set("limit", "100");
    url.searchParams.set("output", "json");
    url.searchParams.set("fl", "timestamp,original,statuscode,mimetype");
    const r = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.per_request_timeout_ms),
    });
    return {
      bytes: Buffer.from(await r.arrayBuffer()),
      contentType: r.headers.get("content-type") || "application/json",
    };
  }

  protected _parse(raw: Buffer, _query: { target: string }): Finding[] {
    let data: any;
    try {
      data = JSON.parse(raw.toString("utf-8"));
    } catch {
      return [];
    }
    if (!Array.isArray(data) || data.length < 2) return [];
    const header: string[] = data[0];
    const findings: Finding[] = [];
    for (const row of data.slice(1)) {
      const entry: Record<string, string> = {};
      header.forEach((h, i) => (entry[h] = row[i]));
      const url = entry.original;
      const ts = entry.timestamp;
      if (!url || !ts) continue;
      const archive = `https://web.archive.org/web/${ts}/${url}`;
      findings.push({
        source_tool: this.name,
        entity_kind: "url",
        entity_value: archive,
        attributes: {
          original: url,
          timestamp: ts,
          status: entry.statuscode,
          mimetype: entry.mimetype,
        },
      });
    }
    return findings;
  }
}
