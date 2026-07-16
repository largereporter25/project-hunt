/**
 * GET /api/vault/[id] — single evidence record, with optional raw
 * payload.
 *
 * `?include_payload=true` adds `raw_payload` (parsed JSON if the
 * payload is JSON, else `raw_payload_text`). Also re-derives the
 * SHA-256 to flag tampering via `data_bleed_flags`.
 */

import { NextRequest, NextResponse } from "next/server";
import { EvidenceVault, LineageError } from "@/lib/vault";
import { withClient } from "@/lib/db";
import { sha256Hex } from "@/lib/tsa";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = params.id;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json(
      { error: "bad_id", detail: "evidence id must be a UUID" },
      { status: 400 }
    );
  }
  const includePayload = req.nextUrl.searchParams.get("include_payload") === "true";

  const vault = new EvidenceVault();
  let validated;
  try {
    validated = await vault.validateLineage(id);
  } catch (e) {
    if (e instanceof LineageError) {
      return NextResponse.json(
        { error: "not_found", detail: e.message },
        { status: 404 }
      );
    }
    throw e;
  }

  // Re-derive the hash from the stored bytes for the tampering flag.
  const rawBytes = Buffer.from(validated.content_b64, "base64");
  const lineageValid = sha256Hex(rawBytes) === validated.payload_sha256;

  const body: Record<string, unknown> = {
    id: validated.id,
    source_tool: validated.source_tool,
    query_params: validated.query_params,
    payload_sha256: validated.payload_sha256,
    tsa_authority: validated.tsa_authority,
    tsa_stamped_at: validated.tsa_stamped_at
      ? new Date(validated.tsa_stamped_at).toISOString()
      : null,
    tsa_trusted: Boolean(validated.tsa_trusted),
    created_at: new Date(validated.created_at).toISOString(),
    lineage_valid: lineageValid,
    data_bleed_flags: lineageValid
      ? []
      : [
          {
            code: "PAYLOAD_HASH_MISMATCH",
            severity: "critical",
            detail: "Decoded payload no longer matches its stored SHA-256.",
          },
        ],
  };

  if (includePayload) {
    body.byte_length = rawBytes.length;
    body.content_type = validated.content_type;
    try {
      body.raw_payload = JSON.parse(rawBytes.toString("utf-8"));
    } catch {
      body.raw_payload_text = rawBytes.toString("utf-8");
    }
  }
  return NextResponse.json(body);
}
