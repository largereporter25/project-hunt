/**
 * WHOIS / RDAP lookup.
 *
 * Tries RDAP first (returns structured JSON with registrant info),
 * then falls back to a text-based WHOIS server.
 *
 * No API key required. Works for domains.
 */

import { ToolFunction, type FetchResult, type Finding } from "./base";

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;

export class WhoisTool extends ToolFunction {
  readonly name = "whois";
  readonly accepts = new Set(["domain"]);
  readonly emits = new Set(["org", "email", "person", "domain"]);
  readonly description = "RDAP/WHOIS registrant + registrar + email extraction.";
  readonly per_request_timeout_ms = 10_000;

  private static RDAP_URL = "https://rdap.org/domain/{target}";
  private static WHOIS_HOST = "https://whois.iana.org/{target}";

  protected async _fetch(query: { target: string }): Promise<FetchResult> {
    const target = (query.target || "").trim().toLowerCase();
    // Try RDAP first.
    try {
      const r = await fetch(
        WhoisTool.RDAP_URL.replace("{target}", target),
        { signal: AbortSignal.timeout(this.per_request_timeout_ms) }
      );
      if (r.ok) {
        const bytes = Buffer.from(await r.arrayBuffer());
        return {
          bytes,
          contentType: r.headers.get("content-type") || "application/rdap+json",
        };
      }
    } catch {
      // fall through to text WHOIS
    }
    const r2 = await fetch(WhoisTool.WHOIS_HOST.replace("{target}", target), {
      signal: AbortSignal.timeout(this.per_request_timeout_ms),
    });
    return { bytes: Buffer.from(await r2.arrayBuffer()), contentType: "text/plain" };
  }

  protected _parse(raw: Buffer, query: { target: string }): Finding[] {
    const target = (query.target || "").trim().toLowerCase();
    const findings: Finding[] = [];
    let data: any = null;
    try {
      data = JSON.parse(raw.toString("utf-8"));
    } catch {
      data = null;
    }

    if (data && Array.isArray(data.entities)) {
      for (const entity of data.entities as any[]) {
        const roles: string[] = entity.roles || [];
        const vcard = entity.vcardArray || [null, []];
        let name = "";
        let email = "";
        if (Array.isArray(vcard) && Array.isArray(vcard[1])) {
          for (const entry of vcard[1] as any[][]) {
            if (entry && entry[0] === "fn") name = String(entry[3] ?? "");
            if (entry && entry[0] === "email") email = String(entry[3] ?? "");
          }
        }
        if (roles.includes("registrant") && email) {
          findings.push({
            source_tool: this.name,
            entity_kind: "email",
            entity_value: email,
            attributes: { role: "registrant", name, domain: target },
          });
        }
        if (roles.includes("registrar") && name) {
          findings.push({
            source_tool: this.name,
            entity_kind: "org",
            entity_value: name,
            attributes: { role: "registrar", domain: target },
          });
        }
      }
      return findings;
    }

    const text = raw.toString("utf-8");
    for (const m of text.matchAll(EMAIL_RE)) {
      findings.push({
        source_tool: this.name,
        entity_kind: "email",
        entity_value: m[0].toLowerCase(),
        attributes: { role: "registrant", domain: target, source: "whois-text" },
      });
    }
    const registrar = /Registrar:\s*(.+)/.exec(text);
    if (registrar) {
      findings.push({
        source_tool: this.name,
        entity_kind: "org",
        entity_value: registrar[1].trim(),
        attributes: { role: "registrar", domain: target },
      });
    }
    return findings;
  }
}
