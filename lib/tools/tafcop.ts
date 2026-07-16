/**
 * TAFCOP — DoT mobile-number connection audit.
 *
 * No API key. Returns a one-click deep-link to the search page.
 */

import { ToolFunction, type FetchResult, type Finding } from "./base";

const SEARCH_URL = "https://tafcop.dgtelecom.gov.in/";

export class TafcopTool extends ToolFunction {
  readonly name = "tafcop";
  readonly accepts = new Set(["phone"]);
  readonly emits = new Set(["person", "phone"]);
  readonly docs_url = "https://tafcop.dgtelecom.gov.in/";
  readonly description = "TAFCOP — DoT mobile number connection audit.";
  readonly per_request_timeout_ms = 20_000;

  protected async _fetch(query: { target: string }): Promise<FetchResult> {
    const url = new URL(SEARCH_URL);
    url.searchParams.set("mobileNo", query.target);
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
        entity_kind: "phone",
        entity_value: target,
        attributes: {
          deep_link: `${SEARCH_URL}?mobileNo=${encodeURIComponent(target)}`,
          extraction_schema: {
            phone: "string",
            linked_name: "string",
            linked_count: "number",
          },
        },
      },
    ];
  }
}
