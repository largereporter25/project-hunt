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
uvicorn api.index:app --app-dir api/core --reload --port 8000

# Frontend (separate terminal)
npm install
npm run dev
```

The dev server proxies `/api/*` to the Python backend (see
`next.config.js`). Open <http://localhost:3000>, type a target, hit
Enter.

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

## Deploying to Vercel

```bash
# First time
vercel

# Production
vercel --prod
```

Vercel picks up the build configuration from `vercel.json` — the
Python handler at `api/index.py` and the Next.js frontend. No
further configuration is needed for the free modules. Add the env
vars you want to the Vercel project dashboard to enable the paid
modules.

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
