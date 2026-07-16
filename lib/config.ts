/**
 * Centralized environment configuration.
 *
 * No secret is required. The app boots and serves traffic with no env
 * vars at all. Setting DATABASE_URL unlocks persistence; setting a
 * provider key enables that OSINT module.
 *
 * On Vercel, DATABASE_URL must point at a hosted Postgres
 * (Neon, Supabase, or Vercel Postgres) — Vercel serverless has no
 * writable filesystem, so SQLite would lose data between cold starts.
 */

export interface Settings {
  database_url: string;
  is_vercel: boolean;
  is_postgres: boolean;

  app_env: string;
  log_level: string;

  // OSINT provider keys (all optional).
  shodan_api_key: string | null;
  hibp_api_key: string | null;
  virustotal_api_key: string | null;
  greynoise_api_key: string | null;
  securitytrails_api_key: string | null;
  ipinfo_api_key: string | null;
  maltego_api_key: string | null;
  factchecktools_api_key: string | null;
  gemini_api_key: string | null;

  // RFC 3161 trusted timestamping.
  tsa_urls: string[];
  tsa_required: boolean;
  tsa_timeout_seconds: number;
}

const DEFAULT_TSA_CHAIN = "https://freetsa.org/tsr,http://timestamp.digicert.com";

function envStr(name: string, fallback = ""): string {
  const v = process.env[name];
  if (v === undefined || v === null) return fallback;
  return String(v);
}

function envOptional(name: string): string | null {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === "") return null;
  return String(v).trim();
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === null) return fallback;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) return cached;

  const database_url = envStr(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/postgres"
  );
  const is_vercel =
    Boolean(process.env.VERCEL) || Boolean(process.env.VERCEL_ENV);
  const is_postgres = database_url.startsWith("postgres");

  cached = {
    database_url,
    is_vercel,
    is_postgres,

    app_env: envStr("APP_ENV", "dev"),
    log_level: envStr("LOG_LEVEL", "INFO"),

    shodan_api_key: envOptional("SHODAN_API_KEY"),
    hibp_api_key: envOptional("HIBP_API_KEY"),
    virustotal_api_key: envOptional("VIRUSTOTAL_API_KEY"),
    greynoise_api_key: envOptional("GREYNOISE_API_KEY"),
    securitytrails_api_key: envOptional("SECURITYTRAILS_API_KEY"),
    ipinfo_api_key: envOptional("IPINFO_API_KEY"),
    maltego_api_key: envOptional("MALTEGO_API_KEY"),
    factchecktools_api_key: envOptional("FACTCHECKTOOLS_API_KEY"),
    gemini_api_key: envOptional("GEMINI_API_KEY"),

    tsa_urls: envStr("TSA_URLS", DEFAULT_TSA_CHAIN)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    tsa_required: envBool("TSA_REQUIRED", false),
    tsa_timeout_seconds: envNum("TSA_TIMEOUT_SECONDS", 3.0),
  };
  return cached;
}

/** Map a SourceTool name to the env var that enables it, if any. */
export function keyEnvFor(toolName: string): string | null {
  switch (toolName) {
    case "shodan":
      return "SHODAN_API_KEY";
    case "virustotal":
      return "VIRUSTOTAL_API_KEY";
    case "hibp":
      return "HIBP_API_KEY";
    case "greynoise":
      return "GREYNOISE_API_KEY";
    case "securitytrails":
      return "SECURITYTRAILS_API_KEY";
    case "maltego":
      return "MALTEGO_API_KEY";
    case "factcheck":
      return "FACTCHECKTOOLS_API_KEY";
    case "ipinfo":
      return "IPINFO_API_KEY";
    default:
      return null;
  }
}

export function isKeyPresent(toolName: string): boolean {
  const env = keyEnvFor(toolName);
  if (!env) return true; // tools that don't need a key are always "present"
  return Boolean(envOptional(env));
}
