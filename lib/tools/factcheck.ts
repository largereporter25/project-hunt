/**
 * Google Fact Check Tools — claim verification.
 *
 * API key required (FACTCHECKTOOLS_API_KEY). The registry hides
 * the tool when the key is missing.
 */

import { ToolFunction, type FetchResult, type Finding } from "./base";
import { getSettings } from "../config";

export class FactCheckTool extends ToolFunction {
  readonly name = "factcheck";
  readonly accepts = new Set(["claim", "domain", "person", "org"]);
  readonly emits = new Set(["claim", "url"]);
  readonly key_required = true;
  readonly docs_url = "https://developers.google.com/fact-check/tools/api";
  readonly description = "Google Fact Check Tools — claim verification search.";
  readonly per_request_timeout_ms = 10_000;

  private static URL = "https://factchecktools.googleapis.com/v1alpha1/claims:search";

  protected async _fetch(query: { target: string }): Promise<FetchResult> {
    const key = getSettings().factchecktools_api_key;
    const url = new URL(FactCheckTool.URL);
    url.searchParams.set("query", query.target);
    url.searchParams.set("key", key || "");
    url.searchParams.set("pageSize", "20");
    const r = await fetch(url.toString(), {
      signal: AbortSignal.timeout(this.per_request_timeout_ms),
    });
    return {
      bytes: Buffer.from(await r.arrayBuffer()),
      contentType: r.headers.get("content-type") || "application/json",
    };
  }

  protected _parse(raw: Buffer, _query: { target: string }): Finding[] {
    let data: any = {};
    try {
      data = JSON.parse(raw.toString("utf-8"));
    } catch {
      return [];
    }
    const findings: Finding[] = [];
    for (const claim of data.claims || []) {
      const text = claim.text || "";
      const reviews = claim.claimReview || [];
      const first = reviews[0] || {};
      if (text) {
        findings.push({
          source_tool: this.name,
          entity_kind: "claim",
          entity_value: text,
          attributes: {
            publisher: first.publisher?.name,
            rating: first.textualRating,
            url: first.url,
          },
        });
      }
    }
    return findings;
  }
}
