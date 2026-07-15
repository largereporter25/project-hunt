/**
 * Domain types mirroring the FastAPI `hunt` schemas. These are the only
 * types the UI components import; they form the contract between the
 * Python serverless handler and the Next.js frontend.
 */

export type EntityKind =
  | "domain"
  | "subdomain"
  | "ipv4"
  | "ipv6"
  | "email"
  | "phone"
  | "username"
  | "person"
  | "org"
  | "cert"
  | "asn"
  | "url"
  | "hash"
  | "breach"
  | "company_registration"
  | "court_case"
  | "claim";

export type SourceTool =
  | "spiderfoot"
  | "shodan"
  | "theharvester"
  | "hibp"
  | "whois"
  | "dns"
  | "wayback_cdx"
  | "virustotal"
  | "crt_sh"
  | "securitytrails"
  | "greynoise"
  | "ipinfo"
  | "maltego"
  | "factcheck"
  | "mca21"
  | "nse_bse"
  | "myneta_adr"
  | "indian_kanoon"
  | "ecourts"
  | "tafcop"
  | "truecaller"
  | "rti_online";

export interface LineageRef {
  evidence_id: string;
  payload_sha256: string;
}

export interface Finding {
  id: string;
  source_tool: SourceTool;
  entity_kind: EntityKind;
  entity_value: string;
  attributes: Record<string, unknown>;
  observed_at: string | null;
  lineage: LineageRef;
}

export interface ModuleInfo {
  name: SourceTool;
  accepts: string[];
  emits: EntityKind[];
}

export interface HuntResponse {
  target: string;
  kind: string | null;
  findings: Finding[];
  modules_run: string[];
  module_errors: Record<string, string>;
}

export interface GraphNode {
  id: string;
  kind: EntityKind;
  value: string;
  seen_by?: string[];
  rules?: string[];
  attributes?: Record<string, unknown>;
  first_seen?: string | null;
  last_seen?: string | null;
}

export interface GraphEdge {
  src: string;
  dst: string;
  id?: string;
  rule?: string;
  weight?: number;
  join_value?: string;
  evidence_ids?: string[];
  lhs_tool?: string;
  rhs_tool?: string;
  cross_source?: boolean;
  created_at?: string | null;
  attributes?: Record<string, unknown>;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface DataBleedFlag {
  code: string;
  severity: "info" | "warning" | "critical";
  detail: string;
}

export interface EvidenceRecord {
  id: string;
  source_tool: SourceTool;
  query_params: Record<string, unknown>;
  payload_sha256: string;
  tsa_authority: string | null;
  tsa_stamped_at: string | null;
  created_at: string;
  lineage_valid?: boolean;
  data_bleed_flags?: DataBleedFlag[];
  byte_length?: number;
  content_type?: string | null;
  raw_payload?: unknown;
  raw_payload_text?: string | null;
}

export interface Stats {
  evidence_count: number;
  finding_count: number;
  edge_count: number;
}
