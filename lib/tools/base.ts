/**
 * Tool function abstraction.
 *
 * A `ToolFunction` is the only thing the rest of the system knows
 * about an external OSINT service. Subclasses declare their name,
 * `accepts` kinds, and `emits` kinds, and implement `_fetch` +
 * `_parse`.
 *
 * The base class wires SHA-256 → RFC 3161 → Evidence Vault in front
 * of `_parse` automatically, so implementations can never
 * accidentally skip provenance. Failures inside `_fetch` or
 * `_parse` are caught and converted to a single "module error"
 * finding so one bad upstream cannot poison an entire hunt.
 *
 * Direct port of the Python `ToolFunction` in
 * `api/core/hunt/ingestion/base.py`. Same contract, same
 * failure semantics.
 */

import { EvidenceVault, type LineageToken } from "../vault";

export interface ToolQuery {
  target: string;
  kind?: string | null;
}

export interface Finding {
  source_tool: string;
  entity_kind: string;
  entity_value: string;
  attributes: Record<string, unknown>;
  /** Set by the base class after vault logging. Stripped before persistence. */
  _hunt_lineage?: LineageToken;
}

export interface FetchResult {
  bytes: Buffer;
  contentType?: string | null;
}

export abstract class ToolFunction {
  abstract readonly name: string;
  abstract readonly accepts: Set<string>;
  abstract readonly emits: Set<string>;
  readonly key_required: boolean = false;
  readonly docs_url?: string;
  readonly description: string = "";
  readonly per_request_timeout_ms: number = 8000;

  protected vault: EvidenceVault;

  constructor(vault?: EvidenceVault) {
    this.vault = vault ?? new EvidenceVault();
  }

  /**
   * Fetch + log provenance + parse. Never throws; returns [] or a
   * single error finding on failure.
   */
  async run(query: ToolQuery): Promise<Finding[]> {
    let token: LineageToken;
    let raw: Buffer;
    try {
      const fetched = await this._fetchWithTimeout(query);
      if (fetched.status && fetched.status >= 400) {
        return [this._moduleError("fetch_failed", `upstream HTTP ${fetched.status}`)];
      }
      const result = await this._fetch(query);
      if (result.bytes.length === 0) {
        return [this._moduleError("fetch_failed", "empty response body")];
      }
      token = await this.vault.log(
        this.name,
        { target: query.target, kind: query.kind ?? "" },
        result.bytes,
        result.contentType ?? null
      );
      raw = result.bytes;
    } catch (e) {
      return [this._moduleError("fetch_failed", String(e).slice(0, 240))];
    }

    let parsed: Finding[];
    try {
      parsed = await this._parse(raw, query);
    } catch (e) {
      return [this._moduleError("parse_failed", String(e).slice(0, 240))];
    }
    for (const f of parsed) {
      f._hunt_lineage = token;
    }
    return parsed;
  }

  private async _fetchWithTimeout(_query: ToolQuery): Promise<{ status?: number }> {
    return {};
  }

  protected abstract _fetch(query: ToolQuery): Promise<FetchResult>;

  protected abstract _parse(
    raw: Buffer,
    query: ToolQuery
  ): Promise<Finding[]> | Finding[];

  protected _moduleError(code: string, message: string): Finding {
    return {
      source_tool: this.name,
      entity_kind: "domain",
      entity_value: "",
      attributes: {
        module_error: code,
        message,
        docs_url: this.docs_url,
        description: this.description,
      },
    };
  }
}

/**
 * A tool that doesn't make any upstream call — it just emits one
 * "key required" finding. Used for the paid/key-required OSINT
 * sources. The dashboard shows them in the catalogue with a
 * "key required" chip; the user knows what to configure.
 */
export abstract class StubTool extends ToolFunction {
  readonly key_required: boolean = true;

  protected async _fetch(_query: ToolQuery): Promise<FetchResult> {
    const body = Buffer.from(
      JSON.stringify({ stub: true, tool: this.name })
    );
    return { bytes: body, contentType: "application/json" };
  }

  protected _parse(_raw: Buffer, _query: ToolQuery): Finding[] {
    return [
      {
        source_tool: this.name,
        entity_kind: "domain",
        entity_value: "",
        attributes: {
          module_error: "key_required",
          docs_url: this.docs_url,
          description: this.description,
          message: `${this.name} requires an API key. Set the corresponding env var to enable this tool.`,
        },
      },
    ];
  }
}
