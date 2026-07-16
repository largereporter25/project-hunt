/**
 * eCourts — Indian district court case status.
 *
 * No API key. Returns a one-click deep-link to the search page.
 */

import { ToolFunction, type FetchResult, type Finding } from "./base";

const SEARCH_URL = "https://services.ecourts.gov.in/ecourtindia_v6/";

export class ECourtsTool extends ToolFunction {
  readonly name = "ecourts";
  readonly accepts = new Set(["court_case", "person"]);
  readonly emits = new Set(["court_case"]);
  readonly docs_url = "https://services.ecourts.gov.in/";
  readonly description = "eCourts — Indian district court case status.";
  readonly per_request_timeout_ms = 20_000;

  protected async _fetch(query: { target: string }): Promise<FetchResult> {
    const url = new URL(SEARCH_URL);
    url.searchParams.set("search_by", "case_no");
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
        entity_kind: "court_case",
        entity_value: target,
        attributes: {
          deep_link: `${SEARCH_URL}?search_by=case_no&q=${encodeURIComponent(target)}`,
          extraction_schema: {
            case_number: "string",
            court: "string",
            next_hearing: "string",
            petitioner: "string",
            respondent: "string",
          },
        },
      },
    ];
  }
}
