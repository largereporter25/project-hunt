/**
 * Evidence Vault logger.
 *
 * The flow for every tool fetch:
 *   1. Hash the raw bytes (SHA-256).
 *   2. Get a TSA stamp on the hash (RFC 3161).
 *   3. Insert into `raw_payloads` (ON CONFLICT DO NOTHING — same
 *      content, same hash, dedup at the row level).
 *   4. Insert into `evidence_vault` (one row per tool invocation).
 *   5. Return a `LineageToken` so the tool's findings can FK to it.
 *
 * The lineage chain is: Finding -> evidence_vault -> raw_payloads.
 * `validateLineage()` re-derives the hash from the stored bytes and
 * flags a mismatch — this is what guards against tampering.
 */

import { withClient } from "./db";
import { sha256Hex, TsaClient, TsaError, type TsaToken } from "./tsa";

export class LineageError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "LineageError";
  }
}

export interface LineageToken {
  evidence_id: string;
  payload_sha256: string;
  tsa_authority: string | null;
  tsa_stamped_at: string | null;
  tsa_trusted: boolean;
}

export class EvidenceVault {
  private tsa: TsaClient;

  constructor(tsa?: TsaClient) {
    this.tsa = tsa ?? new TsaClient();
  }

  async log(
    sourceTool: string,
    queryParams: Record<string, unknown>,
    rawBytes: Buffer,
    contentType: string | null = null
  ): Promise<LineageToken> {
    if (!rawBytes || rawBytes.length === 0) {
      throw new LineageError("Refusing to log an empty payload");
    }
    const digest = sha256Hex(rawBytes);
    const tsaToken = await this.tsa.stamp(digest);

    return withClient(async (c) => {
      // 1) Get-or-create the raw payload row.
      const upsertPayload = await c.query(
        `INSERT INTO raw_payloads (sha256, content_b64, byte_length, content_type)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (sha256) DO NOTHING
         RETURNING id`,
        [digest, rawBytes.toString("base64"), rawBytes.length, contentType]
      );

      // 2) Insert the evidence row.
      const evRes = await c.query(
        `INSERT INTO evidence_vault
           (source_tool, query_params, payload_sha256,
            tsa_token_b64, tsa_authority, tsa_stamped_at, tsa_trusted)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          sourceTool,
          JSON.stringify(queryParams),
          digest,
          tsaToken.token_b64 || null,
          tsaToken.authority,
          tsaToken.stamped_at.toISOString(),
          tsaToken.trusted ? 1 : 0,
        ]
      );

      return {
        evidence_id: evRes.rows[0].id,
        payload_sha256: digest,
        tsa_authority: tsaToken.authority,
        tsa_stamped_at: tsaToken.stamped_at.toISOString(),
        tsa_trusted: tsaToken.trusted,
      };
    });
  }

  /**
   * Re-derive the SHA-256 from the stored bytes and compare with the
   * recorded `payload_sha256`. Throws on mismatch.
   */
  async validateLineage(evidenceId: string) {
    return withClient(async (c) => {
      const r = await c.query(
        `SELECT ev.id, ev.source_tool, ev.query_params, ev.payload_sha256,
                ev.tsa_authority, ev.tsa_stamped_at, ev.tsa_trusted, ev.created_at,
                rp.content_b64, rp.byte_length, rp.content_type
         FROM evidence_vault ev
         JOIN raw_payloads rp ON rp.sha256 = ev.payload_sha256
         WHERE ev.id = $1`,
        [evidenceId]
      );
      if (r.rows.length === 0) {
        throw new LineageError(`No evidence record ${evidenceId}`);
      }
      const row = r.rows[0];
      const rawBytes = Buffer.from(row.content_b64, "base64");
      if (sha256Hex(rawBytes) !== row.payload_sha256) {
        throw new LineageError(
          `Evidence ${evidenceId} payload hash mismatch — possible tampering`
        );
      }
      return row;
    });
  }
}
