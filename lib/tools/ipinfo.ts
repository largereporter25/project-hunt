/**
 * IPinfo — IP geolocation + ASN + org.
 *
 * The free tier (50k requests/month) requires no key for the first
 * install. Set `IPINFO_API_KEY` for higher rate limits.
 */

import { ToolFunction, type FetchResult, type Finding } from "./base";
import { getSettings } from "../config";

export class IpinfoTool extends ToolFunction {
  readonly name = "ipinfo";
  readonly accepts = new Set(["ipv4", "ipv6", "domain", "person", "org"]);
  readonly emits = new Set(["asn", "ipv4", "org"]);
  readonly docs_url = "https://ipinfo.io/developers";
  readonly description = "IPinfo — IP geolocation, ASN, and organization.";
  readonly per_request_timeout_ms = 8_000;

  private static URL = "https://ipinfo.io/{target}/json";

  protected async _fetch(query: { target: string }): Promise<FetchResult> {
    const key = getSettings().ipinfo_api_key;
    const headers: Record<string, string> = {};
    if (key) headers["Authorization"] = `Bearer ${key}`;
    const r = await fetch(
      IpinfoTool.URL.replace("{target}", encodeURIComponent(query.target)),
      {
        headers,
        signal: AbortSignal.timeout(this.per_request_timeout_ms),
      }
    );
    return {
      bytes: Buffer.from(await r.arrayBuffer()),
      contentType: r.headers.get("content-type") || "application/json",
    };
  }

  protected _parse(raw: Buffer, query: { target: string }): Finding[] {
    let data: any = {};
    try {
      data = JSON.parse(raw.toString("utf-8"));
    } catch {
      return [];
    }
    const findings: Finding[] = [];
    const ip = data.ip || query.target;
    findings.push({
      source_tool: this.name,
      entity_kind: "ipv4",
      entity_value: ip,
      attributes: {
        city: data.city,
        region: data.region,
        country: data.country,
        loc: data.loc,
        org: data.org,
        hostname: data.hostname,
      },
    });
    const org = data.org;
    if (org && typeof org === "string" && org.startsWith("AS")) {
      const parts = org.split(" ", 2);
      if (parts.length === 2) {
        const [asn, name] = parts;
        findings.push({
          source_tool: this.name,
          entity_kind: "asn",
          entity_value: asn,
          attributes: { name, ip },
        });
        findings.push({
          source_tool: this.name,
          entity_kind: "org",
          entity_value: name,
          attributes: { asn, ip },
        });
      }
    }
    return findings;
  }
}
