# Project HUNT

> A unified **OSINT investigation dashboard** with cryptographic
> chain-of-custody. Free, no-API-key tools out of the box; paid
> modules render as "configure a key to enable" placeholders.
> Deploys to Vercel as a single monorepo.

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

## Quick start

```bash
# Backend
python -m venv .venv && . .venv/bin/activate   # or: py -m venv .venv
pip install -r requirements.txt
uvicorn hunt.main:app --app-dir api/core --reload --port 8000

# Frontend (separate terminal)
npm install
npm run dev
```

Open <http://localhost:3000>, type a target, hit Enter. The browser
calls the backend at `http://localhost:8000/api/v1/*` directly — the
Vercel rewrite proxy that earlier versions used is gone.

## Architecture

The deployment is **split**:

| Component  | Where it lives                | Why                                              |
| ---------- | ----------------------------- | ------------------------------------------------ |
| Frontend   | Vercel (static + SSR)         | Edge CDN, no state, free hosting                 |
| Backend    | Railway / Render (long-lived) | uvicorn process, real Postgres, RFC 3161 timing  |
| Database   | Railway Postgres **or** Neon  | Persistent across deploys; SQLite works in dev    |

The frontend's API client (`components/lib/api.ts`) reads the
backend URL from the build-time env var `NEXT_PUBLIC_API_URL`. CORS
on the backend allows all origins (`allow_origins=["*"]`), so the
cross-origin browser call works without any further configuration.

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
with a **"key required"** chip and a link to the docs page.

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
| GET    | `/healthz`                        | liveness probe                   |
| GET    | `/api/v1/modules`                 | static tool catalogue            |
| POST   | `/api/v1/hunt`                    | run an investigation             |
| GET    | `/api/v1/investigations`          | recent hunts (sidebar)           |
| GET    | `/api/v1/investigations/{id}`     | detail of one hunt               |
| GET    | `/api/v1/findings`                | recent findings                  |
| GET    | `/api/v1/graph`                   | live entity graph                |
| GET    | `/api/v1/vault/{evidence_id}`     | evidence record (+ raw payload)  |
| GET    | `/api/v1/vault`                   | recent evidence records          |
| GET    | `/api/v1/stats`                   | aggregate counters               |
| POST   | `/api/v1/summarize`               | optional Gemini pivot hint       |
| GET    | `/api/v1/export`                  | JSON evidence bundle             |

## Deploying the split stack

The frontend and the backend are deployed **separately**. Pick a
backend host (Railway is documented below; Render works the same
way), then point the Vercel frontend at it.

### 1. Deploy the backend to Railway

1. Sign in to <https://railway.app> with your GitHub account.
2. **New Project → Deploy from GitHub repo** → pick
   `largereporter25/project-hunt` (the same repo as the frontend).
3. In the service settings:
   - **Root Directory** → leave blank (Nixpacks will detect Python
     from `runtime.txt` and `requirements.txt`).
   - **Start Command** → Railway will read it from
     `railway.toml`. If it doesn't, set it manually to:
     `uvicorn hunt.main:app --app-dir api/core --host 0.0.0.0 --port $PORT`
4. **Add a database** → click "+ New" → "Database" → "Postgres".
   Railway provisions a Postgres instance and exposes its URL as
   the `DATABASE_URL` env var on your service. The
   `postgresql://…` URL that Railway gives you works as-is because
   SQLAlchemy accepts the bare `postgresql://` scheme and falls back
   to psycopg2.
5. Wait for the deploy to finish, then copy the public URL Railway
   generated (looks like `https://hunt-api.up.railway.app`).
6. Smoke test: `curl https://hunt-api.up.railway.app/healthz`
   should return `{"status":"ok","app":"hunt","version":"0.2.0"}`.
7. Optional env vars (all blank by default; missing key = tool
   degrades to "key required"):
   - `GEMINI_API_KEY` — enables the AI Pivot panel
   - `FACTCHECKTOOLS_API_KEY` — enables Fact Check tool
   - `IPINFO_API_KEY` — raises the IPinfo free-tier limit
   - `SHODAN_API_KEY`, `VIRUSTOTAL_API_KEY`, `HIBP_API_KEY`,
     `GREYNOISE_API_KEY`, `SECURITYTRAILS_API_KEY`, `MALTEGO_API_KEY`
8. Optional: provision the database on a free external Postgres
   (Neon, Supabase) instead of the Railway plugin. Set
   `DATABASE_URL=postgresql+psycopg2://USER:PASS@HOST/DBNAME` and
   you're done.

### 2. Deploy the frontend to Vercel

1. Sign in to <https://vercel.com> with your GitHub account.
2. **Add New → Project** → import
   `largereporter25/project-hunt` (same repo, the Vercel project
   builds the Next.js frontend only — the Python handler in
   `api/index.py` is no longer routed).
3. In **Project Settings → Environment Variables**, add:
   - `NEXT_PUBLIC_API_URL` = `https://hunt-api.up.railway.app`
     (use the URL from step 1.5; **no trailing slash, no `/api/v1` suffix**)
4. Click **Deploy**. Vercel builds the static/SSR frontend and
   bakes `NEXT_PUBLIC_API_URL` into the JavaScript bundle.

### 3. Verify

```bash
# 1. Backend health (Railway URL)
curl https://hunt-api.up.railway.app/healthz
# {"status":"ok","app":"hunt","version":"0.2.0"}

# 2. Modules endpoint
curl https://hunt-api.up.railway.app/api/v1/modules | head -c 200

# 3. Frontend reachable
curl -I https://project-hunt-kdq3.vercel.app/

# 4. End-to-end: open the Vercel URL in a browser, run a hunt
#    against "tata.com", and watch the DevTools Network panel.
#    Every /api/v1/* request should hit the Railway host, not
#    the Vercel host. The browser console should be free of CORS
#    errors.
```

If you ever want to re-monorepo the backend (deploy Python on Vercel
again, or to Cloud Run / Fly.io), `api/index.py` is still there as
an ASGI entry point — you only need to add the right `vercel.json`
or `Dockerfile`.

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
