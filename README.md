# Project HUNT

> A unified **OSINT investigation dashboard** with cryptographic
> chain-of-custody. Free, no-API-key tools out of the box; paid
> modules render as "configure a key to enable" placeholders.
> **Deploys to Vercel as a single monorepo** — frontend + FastAPI
> backend + Postgres in one project.

Project HUNT lets an analyst type a target (a domain, an IP, an email,
a phone, a person) and run it through every OSINT module at once.
Every raw response is **SHA-256 hashed** and **RFC 3161 timestamped**
*before* it is parsed, so the resulting findings carry an unbroken
chain of custody all the way back to the bytes that were fetched.

The dashboard then correlates findings across sources — a subdomain
that appears in crt.sh *and* the Wayback Machine, a person that
appears in WHOIS *and* India corporate filings, an IP that shows up
in DNS *and* Shodan — into a single entity graph you can pivot
through.

The free tier is fully functional with no API keys configured.

## Quick start (local dev)

```bash
# Backend (SQLite by default — no DATABASE_URL needed)
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn hunt.main:app --app-dir api/core --reload --port 8000

# Frontend (separate terminal)
npm install
NEXT_PUBLIC_API_URL=http://localhost:8000 npm run dev
```

Open <http://localhost:3000>, type a target, hit Enter. The browser
calls `http://localhost:8000/api/v1/*` directly (CORS is wide-open in
dev), the FastAPI handler runs the tools, hashes the payloads, and
returns the findings.

## Architecture (single-deployment Vercel)

| Component | Where it lives | Why |
| --- | --- | --- |
| Frontend | Vercel (`/`)        | Next.js static + SSR, edge CDN, free hosting |
| Backend  | Vercel (`/api/*`)   | `@vercel/python` serverless function, no state, free up to 100 GB-s |
| Database | Neon / Supabase / Vercel Postgres | Persistent across deploys. SQLite works in dev only — serverless invocations cannot write to a shared FS. |

The frontend's API client (`components/lib/api.ts`) calls `/api/v1/*`
on the **same origin**. Vercel routes that prefix to
`api/index.py` (a thin wrapper around the FastAPI app). No CORS,
no proxy, no Railway.

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

## Routes exposed by the Python handler

| Method | Path                              | Purpose                          |
| ------ | --------------------------------- | -------------------------------- |
| GET    | `/healthz`                        | liveness probe (503 if misconfigured) |
| GET    | `/api/v1/modules`                 | static tool catalogue            |
| POST   | `/api/v1/hunt`                    | run an investigation             |
| GET    | `/api/v1/investigations`          | recent hunts (sidebar)           |
| GET    | `/api/v1/investigations/{id}`     | detail of one hunt               |
| GET    | `/api/v1/findings`                | recent findings                  |
| GET    | `/api/v1/graph`                   | live entity graph                |
| GET    | `/api/v1/vault/{evidence_id}`     | evidence record (+ raw payload)  |
| GET    | `/api/v1/vault`                   | recent evidence records          |
| GET    | `/api/v1/stats`                   | aggregate counters               |
| POST   | `/api/v1/summarize`               | optional pivot-suggestion hint   |
| GET    | `/api/v1/export`                  | JSON evidence bundle             |

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
4. Append `+psycopg2` to the scheme so SQLAlchemy uses the
   psycopg2 driver:
   ```
   postgresql+psycopg2://USER:PASS@ep-xxxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

**Supabase (alternative):**

1. Sign in to <https://supabase.com> with GitHub.
2. New project → pick a name, password, and region.
3. Project Settings → Database → Connection string → **URI**.
   Append `+psycopg2` to the scheme as above.

### 2. Deploy to Vercel

1. Sign in to <https://vercel.com> with your GitHub account.
2. **Add New → Project** → import
   `largereporter25/project-hunt` (the same repo as the backend).
3. Leave all framework / build-command settings at their defaults —
   Vercel detects Next.js automatically and adds the Python build
   from `vercel.json`.
4. **Project Settings → Environment Variables**, add:
   - `DATABASE_URL` = the `postgresql+psycopg2://…` URL from step 1.
5. Click **Deploy**. Vercel builds the Next.js frontend and the
   Python handler together; the browser hits `/api/v1/*` on the
   same origin.

### 3. Verify

```bash
# 1. Liveness
curl https://<your-app>.vercel.app/healthz
# {"status":"ok","app":"hunt","version":"0.2.0"}

# 2. Module catalogue (same origin)
curl https://<your-app>.vercel.app/api/v1/modules | head -c 200

# 3. End-to-end: open the Vercel URL in a browser, run a hunt
#    against "tata.com", and watch the DevTools Network panel.
#    Every /api/v1/* request should hit the Vercel host (same
#    origin as the page), not localhost.
```

If `/healthz` returns `503` with `error: "database_not_configured"`,
the `DATABASE_URL` env var is missing or not a Postgres URL.

### 4. Optional env vars (all blank by default; missing key = tool
   degrades to "key required"):

- `GEMINI_API_KEY` — enables the Pivot Suggestions panel
- `FACTCHECKTOOLS_API_KEY` — enables Fact Check tool
- `IPINFO_API_KEY` — raises the IPinfo free-tier limit
- `SHODAN_API_KEY`, `VIRUSTOTAL_API_KEY`, `HIBP_API_KEY`,
  `GREYNOISE_API_KEY`, `SECURITYTRAILS_API_KEY`, `MALTEGO_API_KEY`
- `TSA_URLS`, `TSA_REQUIRED`, `TSA_TIMEOUT_SECONDS` — RFC 3161
  timestamp authority chain. Default is the free public FreeTSA
  (`https://freetsa.org/tsr,http://timestamp.digicert.com`).

## Why one Vercel deployment (and not the old Railway split)?

The previous version of this README recommended deploying the
FastAPI backend to Railway and the frontend to Vercel. That
worked but it had two failure modes that bit real users:

1. If you forgot to deploy the backend, the frontend called
   `localhost:8000` (because `NEXT_PUBLIC_API_URL` was unset)
   and **everything looked broken**: the module catalogue
   never loaded, every hunt returned a CORS error.
2. If the Railway free tier put the service to sleep, the
   first Vercel request after the sleep took 30+ seconds to
   warm up, which the browser interpreted as "the app is dead".

Both go away when the backend is a Vercel serverless function
on the same origin: the cold-start is sub-second, the route
always exists, and there's no second service to keep alive.

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
