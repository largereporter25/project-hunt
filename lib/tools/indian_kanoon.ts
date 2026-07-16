/**
 * Indian Kanoon — Indian court case search.
 *
 * No API key. Returns a one-click deep-link to the search page.
 */

import { ToolFunction, type FetchResult, type Finding } from "./base";

const SEARCH_URL = "https://indiankanoon.org/search/";

export class IndianKanoonTool extends ToolFunction {
  readonly name = "indian_kanoon";
  readonly accepts = new Set(["person", "org", "court_case"]);
  readonly emits = new Set(["court_case", "person"]);
  readonly docs_url = "https://indiankanoon.org/";
  readonly description = "Indian Kanoon — Indian court case search.";
  readonly per_request_timeout_ms = 20_000;

  protected async _fetch(query: { target: string }): Promise<FetchResult> {
    const url = new URL(SEARCH_URL);
    url.searchParams.set("formInput", query.target);
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
        entity_kind: "court_case",
        entity_value: target,
        attributes: {
          deep_link: `${SEARCH_URL}?formInput=${encodeURIComponent(target)}`,
          extraction_schema: {
            title: "string",
            citation: "string",
            court: "string",
            decision_date: "string",
            judges: ["string"],
            summary: "string",
          },
        },
      },
    ];
  }
}
