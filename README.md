# Project HUNT

> A unified **OSINT investigation dashboard** with cryptographic
> chain of custody. Free, no-API-key tools out of the box; paid
> modules render as "configure a key to enable" placeholders.
> **One Vercel deployment** — Next.js frontend + Route Handlers +
> Postgres in a single project.

Project HUNT lets an analyst type a target (a domain, an IP, an email,
a phone, a person) and run it through every OSINT module at once.
Every raw response is **SHA-256 hashed** and **RFC 3161 timestamped**
*before* it is parsed, so the resulting findings carry an unbroken
chain of custody all the way back to the bytes that were fetched.

The free tier is fully functional with no API keys configured.

## Quick start (local dev)

```bash
npm install

# Local Postgres (Neon free tier, Supabase, or a docker postgres).
# The dashboard creates all tables on first request.
export DATABASE_URL="postgresql://USER:PASS@localhost:5432/hunt"

npm run dev
```

Open <http://localhost:3000>, type `help` at the prompt, then type a
target like `example.com` and press Enter.

## Architecture (single-deployment Vercel)

| Component | Where it lives | Why |
| --- | --- | --- |
| Frontend | Vercel (`/`)        | Next.js, single React client component, a `<pre>` and a prompt |
| Backend  | Vercel (`/api/*`)   | Next.js Route Handlers, no separate service to keep alive |
| Database | Neon / Supabase / Vercel Postgres | Serverless functions have no shared FS, so SQLite won't work on Vercel. |

The frontend's API client (inline in `app/page.tsx`) calls `/api/*`
on the **same origin**. No CORS, no proxy, no separate backend.

## Free, no-API-key modules

These work out of the box and never 5xx.

| Module        | Source                              | What it gives you                               |
| ------------- | ----------------------------------- | ----------------------------------------------- |
| **DNS**       | system resolver                     | A/AAAA records                                  |
| **WHOIS**     | RDAP → IANA fallback                | registrant emails, registrar org                |
| **crt.sh**    | Certificate Transparency            | subdomains + issuing CAs                        |
| **Wayback**   | Archive.org CDX API                 | historic URL snapshots                          |
| **IPinfo**    | ipinfo.io                           | IP geolocation, ASN, org (50k/mo free)          |
| **TAFCOP**    | DoT Telecom                         | Indian mobile-number connections                |
| **Indian Kanoon** | indiankanoon.org               | Indian court case search                        |
| **eCourts**   | services.ecourts.gov.in             | Indian district court case status               |
| **MyNeta/ADR** | myneta.info                        | political donation disclosures                  |

The Indian modules are **deep-link generators** with an extraction
schema: the operator clicks through, and a follow-up scraper can
backfill the structured fields. The URL is in the finding's
`attributes.deep_link`.

## Key-gated modules

These are real implementations that activate the moment their env
var is set. Without a key, the dashboard shows them in the catalogue
with a `"key required"` chip and a link to the docs page.

| Module        | Env var               | Docs                                                |
| ------------- | --------------------- | --------------------------------------------------- |
| Shodan        | `SHODAN_API_KEY`      | <https://developer.shodan.io/api>                   |
| VirusTotal    | `VIRUSTOTAL_API_KEY`  | <https://docs.virustotal.com/>                      |
| HIBP          | `HIBP_API_KEY`        | <https://haveibeenpwned.com/API/v3>                 |
| GreyNoise     | `GREYNOISE_API_KEY`   | <https://docs.greynoise.io/>                        |
| SecurityTrails| `SECURITYTRAILS_API_KEY` | <https://docs.securitytrails.com/>              |
| IPinfo (higher limits) | `IPINFO_API_KEY` | <https://ipinfo.io/developers>                |
| Maltego       | `MALTEGO_API_KEY`     | <https://docs.maltego.com/>                         |
| Fact Check    | `FACTCHECKTOOLS_API_KEY` | <https://developers.google.com/fact-check/tools/api> |

Copy `.env.example` to `.env` and paste the keys you want to enable.
The app boots and serves traffic with no keys at all.

## Routes exposed by the handler

| Method | Path                              | Purpose                          |
| ------ | --------------------------------- | -------------------------------- |
| GET    | `/api/healthz`                    | liveness probe (503 if misconfigured) |
| GET    | `/api/modules`                    | static tool catalogue            |
| POST   | `/api/hunt`                       | run an investigation             |
| GET    | `/api/investigations`             | recent hunts                     |
| GET    | `/api/findings`                   | recent findings                  |
| GET    | `/api/graph`                      | live entity graph                |
| GET    | `/api/vault`                      | recent evidence records          |
| GET    | `/api/vault/{id}`                 | evidence record (+ raw payload)  |
| GET    | `/api/stats`                      | aggregate counters               |
| GET    | `/api/export`                     | JSON evidence bundle             |

## Single-pane terminal UI

One prompt, plain text output. Commands:

```
$ hunt> help
help              show this help
modules           list available osint tools
findings          show last 50 findings
graph             show the live entity graph
stats             show counters
vault             show last 20 evidence rows
investigations    show recent investigations
export            download the latest bundle as json
clear             clear the output

<target>          run a hunt against the target
                  e.g. example.com, 8.8.8.8, alice@example.com

$ hunt> example.com
TARGET example.com (domain)
─────────────────────────────────────────────
[DNS]      2 records · 0.12s
           ipv4     93.184.216.34
           ipv6     2606:2800:220:1:248:1893:25c8:1946
[WHOIS]    0 records · 0.81s
[CRT_SH]   1 records · 4.20s
           subdomain www.example.com
...
─────────────────────────────────────────────
SUMMARY  9 findings · 5 tools · 1 edge · 11.6s
```

No panels, no chips, no sidebars, no status line. Just a prompt and
the result of the command you ran.

## Deploying to Vercel

You need **two things**: a Vercel project, and a hosted Postgres
URL. Neon and Supabase both offer a free tier that's more than
enough.

### 1. Provision a Postgres database

**Neon (recommended — fastest to set up):**

1. Sign in to <https://neon.tech> with GitHub.
2. Click **New Project**. Pick a name, region, and the free
   **Postgres 16** tier.
3. After the project is created, copy the **Connection string**
   that looks like:
   ```
   postgresql://USER:PASS@ep-xxxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

**Supabase (alternative):**

1. Sign in to <https://supabase.com> with GitHub.
2. New project → pick a name, password, and region.
3. Project Settings → Database → Connection string → **URI**.

### 2. Deploy to Vercel

1. Sign in to <https://vercel.com> with your GitHub account.
2. **Add New → Project** → import the `project-hunt` repo.
3. Leave all framework / build-command settings at their defaults —
   Vercel detects Next.js automatically.
4. **Project Settings → Environment Variables**, add:
   - `DATABASE_URL` = the `postgresql://…` URL from step 1.
5. Click **Deploy**. Vercel builds the Next.js app; the browser
   hits `/api/*` on the same origin. Tables are created on the
   first request.

### 3. Verify

```bash
# 1. Liveness
curl https://<your-app>.vercel.app/api/healthz
# {"status":"ok","app":"hunt","version":"0.3.0"}

# 2. Module catalogue (same origin)
curl https://<your-app>.vercel.app/api/modules | head -c 200

# 3. End-to-end: open the Vercel URL in a browser, type
#    "example.com" at the prompt, and watch the findings stream in.
```

If `/api/healthz` returns `503` with `error: "database_not_configured"`,
the `DATABASE_URL` env var is missing or malformed.

### 4. Optional env vars (all blank by default; missing key = tool
   degrades to "key required"):

- `SHODAN_API_KEY`, `VIRUSTOTAL_API_KEY`, `HIBP_API_KEY`,
  `GREYNOISE_API_KEY`, `SECURITYTRAILS_API_KEY`, `MALTEGO_API_KEY`,
  `FACTCHECKTOOLS_API_KEY`, `IPINFO_API_KEY`
- `TSA_URLS`, `TSA_REQUIRED`, `TSA_TIMEOUT_SECONDS` — RFC 3161
  timestamp authority chain. Default is the free public FreeTSA
  (`https://freetsa.org/tsr,http://timestamp.digicert.com`).

## Tests

```bash
npm test                    # all 24 tests
```

A Postgres-backed round-trip test (`tests/schema.test.ts`) is gated
on `TEST_DATABASE_URL`:

```bash
TEST_DATABASE_URL=postgresql://USER:PASS@localhost:5432/hunt_test \
  npm test
```

## Responsible use

Project HUNT is a **forensic aggregation** tool. It only queries
publicly available sources and emits deep-link findings where
upstream data is gated, behind a login, or bot-blocked. The Indian
modules, in particular, return official-government URLs you can
click through; the extraction schemas are deliberately minimal so
the tool never scrapes anything that requires a login.

You are responsible for:

- Complying with the **Computer Fraud and Abuse Act**, the **GDPR**,
  the **Indian Information Technology Act**, and any local
  equivalents.
- Honouring each source's **terms of service** and rate limits.
- Not using the dashboard to stalk, harass, dox, or discriminate.
- Treating every finding as a **lead**, not a fact, and verifying
  before publishing.

## License

MIT — see `LICENSE`.
