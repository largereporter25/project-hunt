/**
 * DNS resolution + record enumeration.
 *
 * Pure stdlib resolver — no upstream HTTP, no API key, always works.
 * The output goes through the Evidence Vault so the resolver's
 * answer is hash-attested.
 */

import { promises as dns } from "node:dns";
import { ToolFunction, type FetchResult, type Finding } from "./base";

export class DnsTool extends ToolFunction {
  readonly name = "dns";
  readonly accepts = new Set(["domain", "subdomain", "person", "org"]);
  readonly emits = new Set(["ipv4", "ipv6", "subdomain"]);
  readonly description = "Resolves A/AAAA records via the system resolver.";
  readonly per_request_timeout_ms = 5_000;

  protected async _fetch(query: { target: string; kind?: string | null }): Promise<FetchResult> {
    const target = (query.target || "").trim().toLowerCase();
    const v4 = new Set<string>();
    const v6 = new Set<string>();
    let err: string | null = null;
    try {
      const a = await dns.resolve4(target).catch(() => []);
      const aaaa = await dns.resolve6(target).catch(() => []);
      for (const r of a) v4.add(r);
      for (const r of aaaa) v6.add(r);
    } catch (e) {
      err = String(e);
    }
    const body = Buffer.from(
      JSON.stringify({
        target,
        records: { A: [...v4].sort(), AAAA: [...v6].sort() },
        ...(err ? { error: err } : {}),
      })
    );
    return { bytes: body, contentType: "application/json" };
  }

  protected _parse(raw: Buffer, query: { target: string }): Finding[] {
    const data = JSON.parse(raw.toString("utf-8")) as {
      target?: string;
      records?: { A?: string[]; AAAA?: string[] };
    };
    const findings: Finding[] = [];
    const host = data.target || query.target;
    for (const ip of data.records?.A ?? []) {
      findings.push({
        source_tool: this.name,
        entity_kind: "ipv4",
        entity_value: ip,
        attributes: { record_type: "A", host },
      });
    }
    for (const ip of data.records?.AAAA ?? []) {
      findings.push({
        source_tool: this.name,
        entity_kind: "ipv6",
        entity_value: ip,
        attributes: { record_type: "AAAA", host },
      });
    }
    return findings;
  }
}
