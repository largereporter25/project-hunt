-- Project HUNT — Postgres schema. Idempotent. Loaded on cold start.
--
-- Six tables:
--   raw_payloads      — every fetched response, content_b64 + sha256
--   evidence_vault    — one row per tool invocation, FKs to a raw_payload
--   findings          — normalized observations, FKs to evidence + investigation
--   entities          — deduped nodes in the live graph (UNIQUE on kind+value)
--   entity_relationships — directed edges between entities, with provenance
--   investigations    — one row per /api/hunt call, sidebar data
--
-- All UUIDs are native postgres uuid. JSONB for attributes. The
-- previous Python schema had the same table names and column shapes
-- for backwards-compat with any existing Neon/Supabase DB.

CREATE TABLE IF NOT EXISTS raw_payloads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256        varchar(64) NOT NULL UNIQUE,
  content_b64   text NOT NULL,
  byte_length   bigint NOT NULL,
  content_type  varchar(255),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_vault (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_tool     varchar(64) NOT NULL,
  query_params    jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_sha256  varchar(64) NOT NULL REFERENCES raw_payloads(sha256),
  tsa_token_b64   text,
  tsa_authority   varchar(512),
  tsa_stamped_at  timestamptz,
  tsa_trusted     integer NOT NULL DEFAULT 0,
  operator        varchar(255),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_evidence_vault_tool       ON evidence_vault (source_tool);
CREATE INDEX IF NOT EXISTS ix_evidence_vault_created    ON evidence_vault (created_at DESC);

CREATE TABLE IF NOT EXISTS investigations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target           varchar(2048) NOT NULL,
  kind             varchar(64),
  modules_run      jsonb NOT NULL DEFAULT '[]'::jsonb,
  modules_skipped  jsonb NOT NULL DEFAULT '[]'::jsonb,
  finding_count    integer NOT NULL DEFAULT 0,
  edge_count       integer NOT NULL DEFAULT 0,
  duration_ms      integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_investigations_target     ON investigations (target);
CREATE INDEX IF NOT EXISTS ix_investigations_created    ON investigations (created_at DESC);

CREATE TABLE IF NOT EXISTS findings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investigation_id uuid REFERENCES investigations(id) ON DELETE SET NULL,
  evidence_id      uuid NOT NULL REFERENCES evidence_vault(id),
  source_tool      varchar(64) NOT NULL,
  entity_kind      varchar(64) NOT NULL,
  entity_value     varchar(2048) NOT NULL,
  attributes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_findings_evidence        ON findings (evidence_id);
CREATE INDEX IF NOT EXISTS ix_findings_investigation   ON findings (investigation_id);
CREATE INDEX IF NOT EXISTS ix_findings_tool_kind_value ON findings (source_tool, entity_kind, entity_value);

CREATE TABLE IF NOT EXISTS entities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        varchar(64) NOT NULL,
  value       varchar(2048) NOT NULL,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  attributes  jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_entity_kind_value UNIQUE (kind, value)
);
CREATE INDEX IF NOT EXISTS ix_entities_value ON entities (value);

CREATE TABLE IF NOT EXISTS entity_relationships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  src_entity_id   uuid NOT NULL REFERENCES entities(id),
  dst_entity_id   uuid NOT NULL REFERENCES entities(id),
  rule            varchar(128) NOT NULL,
  weight          integer NOT NULL DEFAULT 1,
  evidence_ids    jsonb NOT NULL DEFAULT '[]'::jsonb,
  attributes      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_rel_triplet UNIQUE (src_entity_id, dst_entity_id, rule)
);
CREATE INDEX IF NOT EXISTS ix_rel_src ON entity_relationships (src_entity_id);
CREATE INDEX IF NOT EXISTS ix_rel_dst ON entity_relationships (dst_entity_id);
