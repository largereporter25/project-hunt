/**
 * RFC 3161 trusted timestamp client.
 *
 * Pure Node — no third-party ASN.1 dependency. The request DER is
 * hand-rolled; the genTime parser is best-effort. Both pieces are
 * tested in `tests/tsa.test.ts`.
 *
 * Same chain semantics as the Python version: try each TSA in order,
 * fall back to a local-clock stamp (marked trusted=false) if all
 * fail and TSA_REQUIRED is false. The local-clock path is what makes
 * dev work without a reachable TSA.
 */

import { createHash } from "node:crypto";
import { getSettings } from "./config";

export class TsaError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "TsaError";
  }
}

export interface TsaToken {
  /** base64 of the RFC 3161 TimeStampToken (or empty for the local fallback) */
  token_b64: string;
  /** The TSA URL that issued the token, or the local-clock label. */
  authority: string;
  /** When the stamp was issued. */
  stamped_at: Date;
  /** False only when we fell back to the local reference. */
  trusted: boolean;
}

export interface TsaAuthority {
  stamp(digestHex: string): Promise<TsaToken>;
}

/** SHA-256 OID: 2.16.840.1.101.3.4.2.1 (DER-encoded). */
const SHA256_OID = Buffer.from([
  0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01,
]);

/**
 * Build a minimal RFC 3161 TimeStampReq DER for SHA-256.
 *
 * Structure:
 *   SEQUENCE {
 *     INTEGER 1                              (version)
 *     SEQUENCE { OID sha256, NULL }          (hashAlgorithm)
 *     OCTET STRING { digest }                (messageImprint)
 *   }
 *
 * Long-form length encoding kicks in for digests > 127 bytes (which
 * SHA-256 isn't, but the code is future-proof for SHA-512).
 */
export function buildTspRequest(digest: Buffer): Buffer {
  if (digest.length < 1) throw new Error("empty digest");
  const algId = Buffer.concat([
    Buffer.from([0x30, SHA256_OID.length + 2, 0x30, SHA256_OID.length]),
    SHA256_OID,
    Buffer.from([0x05, 0x00]),
  ]);

  let msgImprint: Buffer;
  if (digest.length < 128) {
    msgImprint = Buffer.concat([
      Buffer.from([0x30, algId.length + digest.length + 2, 0x04, digest.length]),
      digest,
    ]);
  } else {
    msgImprint = Buffer.concat([
      Buffer.from([
        0x30, 0x81, algId.length + digest.length + 4, 0x04, 0x82,
        (digest.length >> 8) & 0xff, digest.length & 0xff,
      ]),
      digest,
    ]);
  }

  const body = Buffer.concat([
    Buffer.from([0x02, 0x01, 0x01]), // INTEGER version = 1
    algId,
    msgImprint,
  ]);
  return Buffer.concat([
    Buffer.from([0x30, body.length + 2]), // outer SEQUENCE
    body,
  ]);
}

/**
 * Best-effort extraction of `genTime` from an RFC 3161 token.
 * Returns null if parsing fails (caller should fall back to local clock).
 *
 * Strategy: scan the DER for the GeneralizedTime tag (0x18) and parse
 * the following length-prefixed ASCII string as YYYYMMDDHHMMSSZ.
 */
export function parseGenTime(token: Buffer): Date | null {
  if (!token || token.length < 5) return null;
  // 0x18 = GeneralizedTime tag. There may be multiple (e.g. in
  // signingCertificate). The one we want is the `genTime` field of
  // TSTInfo, which is the first GeneralizedTime in the structure.
  for (let i = 0; i < token.length - 3; i++) {
    if (token[i] !== 0x18) continue;
    const len = token[i + 1];
    if (len === 0) continue;
    // Long-form length (0x81 0xNN) for strings > 127 chars.
    let start: number;
    let length: number;
    if (len < 0x80) {
      start = i + 2;
      length = len;
    } else if (len === 0x81 && i + 3 < token.length) {
      start = i + 3;
      length = token[i + 2];
    } else {
      continue;
    }
    if (start + length > token.length) continue;
    const raw = token.subarray(start, start + length).toString("ascii");
    // RFC 3161: YYYYMMDDHHMMSSZ (optionally with sub-second decimals,
    // which we ignore for the moment).
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(raw);
    if (m) {
      const [, y, mo, d, h, mi, s] = m;
      const dt = new Date(
        Date.UTC(
          Number(y),
          Number(mo) - 1,
          Number(d),
          Number(h),
          Number(mi),
          Number(s)
        )
      );
      if (!Number.isNaN(dt.getTime())) return dt;
    }
  }
  return null;
}

/**
 * POSTs the TSP request to a TSA URL with a hard timeout. Returns
 * the raw TimeStampToken bytes.
 */
export class HttpTsa implements TsaAuthority {
  constructor(public readonly url: string, private timeoutMs: number) {}

  async stamp(digestHex: string): Promise<TsaToken> {
    const digest = Buffer.from(digestHex, "hex");
    if (digest.length !== 32) {
      throw new Error("digestHex must be 64 hex chars (SHA-256)");
    }
    const req = buildTspRequest(digest);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/timestamp-query" },
        body: req,
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (resp.status >= 400) {
      const text = (await resp.text()).slice(0, 200);
      throw new TsaError(`TSA ${this.url} HTTP ${resp.status}: ${text}`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0) throw new TsaError(`TSA ${this.url} empty body`);
    const stamped = parseGenTime(buf) ?? new Date();
    return {
      token_b64: buf.toString("base64"),
      authority: this.url,
      stamped_at: stamped,
      trusted: true,
    };
  }
}

export class LocalTsa implements TsaAuthority {
  constructor(private label = "local-clock") {}
  async stamp(_digestHex: string): Promise<TsaToken> {
    return {
      token_b64: "",
      authority: this.label,
      stamped_at: new Date(),
      trusted: false,
    };
  }
}

export class TsaClient {
  private authorities: TsaAuthority[];

  constructor(
    private settings = getSettings(),
    authorities?: TsaAuthority[]
  ) {
    this.authorities =
      authorities ??
      this.settings.tsa_urls.map(
        (url) => new HttpTsa(url, this.settings.tsa_timeout_seconds * 1000)
      );
  }

  async stamp(digestHex: string): Promise<TsaToken> {
    // Sanity-check the digest shape early.
    if (!/^[0-9a-f]{64}$/i.test(digestHex)) {
      throw new Error("digestHex must be a 64-char hex string");
    }
    const hex = digestHex.toLowerCase();

    let lastErr: unknown = null;
    for (const auth of this.authorities) {
      try {
        return await auth.stamp(hex);
      } catch (e) {
        lastErr = e;
        // try the next TSA in the chain
      }
    }
    if (!this.settings.tsa_required) {
      return new LocalTsa().stamp(hex);
    }
    throw new TsaError(
      `All TSAs failed; last error: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`
    );
  }
}

/** Convenience: SHA-256 a Buffer and return a 64-char hex digest. */
export function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
