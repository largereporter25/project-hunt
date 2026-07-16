/**
 * MyNeta / ADR — political donation disclosures.
 *
 * No API key. Returns a one-click deep-link to the search page with
 * an extraction schema the operator can fill in.
 */

import { ToolFunction, type FetchResult, type Finding } from "./base";

const SEARCH_URL = "https://www.myneta.info/search.php";

export class MyNetaAdrTool extends ToolFunction {
  readonly name = "myneta_adr";
  readonly accepts = new Set(["org", "person"]);
  readonly emits = new Set(["org", "person"]);
  readonly docs_url = "https://www.myneta.info/";
  readonly description = "MyNeta / ADR — political donation disclosures.";
  readonly per_request_timeout_ms = 20_000;

  protected async _fetch(query: { target: string }): Promise<FetchResult> {
    const url = new URL(SEARCH_URL);
    url.searchParams.set("q", query.target);
    const r = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.per_request_timeout_ms),
    });
    return { bytes: Buffer.from(await r.arrayBuffer()) };
  }

  protected _parse(_raw: Buffer, query: { target: string }): Finding[] {
    const target = query.target;
    return [
      {
        source_tool: this.name,
        entity_kind: "org",
        entity_value: target,
        attributes: {
          deep_link: `${SEARCH_URL}?q=${encodeURIComponent(target)}`,
          extraction_schema: {
            donor: "string",
            recipient_party: "string",
            amount_inr: "number",
            donation_date: "string",
          },
        },
      },
    ];
  }
}
