/**
 * crt.sh — certificate transparency log search.
 *
 * No API key. Returns every certificate ever issued for a domain,
 * which is gold for subdomain enumeration and pivot-by-cert.
 */

import { ToolFunction, type FetchResult, type Finding } from "./base";

export class CrtshTool extends ToolFunction {
  readonly name = "crt_sh";
  readonly accepts = new Set(["domain", "person", "org"]);
  readonly emits = new Set(["cert", "org", "subdomain"]);
  readonly docs_url = "https://crt.sh/";
  readonly description = "Certificate Transparency log search via crt.sh.";
  readonly per_request_timeout_ms = 20_000;

  private static URL = "https://crt.sh/";

  protected async _fetch(query: { target: string }): Promise<FetchResult> {
    const target = (query.target || "").trim().toLowerCase();
    const url = new URL(CrtshTool.URL);
    url.searchParams.set("q", `%.${target}`);
    url.searchParams.set("output", "json");
    const r = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.per_request_timeout_ms),
    });
    return {
      bytes: Buffer.from(await r.arrayBuffer()),
      contentType: r.headers.get("content-type") || "application/json",
    };
  }

  protected _parse(raw: Buffer, query: { target: string }): Finding[] {
    const target = (query.target || "").trim().toLowerCase();
    let rows: any[] = [];
    try {
      const parsed = JSON.parse(raw.toString("utf-8"));
      if (Array.isArray(parsed)) rows = parsed;
    } catch {
      return [];
    }
    const findings: Finding[] = [];
    const seenSub = new Set<string>();
    for (const row of rows.slice(0, 200)) {
      const name = String(row.name_value || "").trim().toLowerCase();
      if (!name) continue;
      for (const sub of name.split("\n")) {
        const s = sub.trim();
        if (!s.endsWith(target) && s !== target) continue;
        if (seenSub.has(s)) continue;
        seenSub.add(s);
        findings.push({
          source_tool: this.name,
          entity_kind: "subdomain",
          entity_value: s,
          attributes: { parent_domain: target },
        });
      }
      const certId = row.id;
      const issuer = String(row.issuer_name || "").trim();
      if (certId && issuer) {
        findings.push({
          source_tool: this.name,
          entity_kind: "cert",
          entity_value: String(certId),
          attributes: {
            issuer,
            common_name: String(row.common_name || "").trim(),
            not_before: row.not_before,
            not_after: row.not_after,
            domain: target,
          },
        });
      }
    }
    return findings;
  }
}
