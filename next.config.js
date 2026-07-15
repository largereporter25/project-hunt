/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The frontend is a pure static/SSR app on Vercel. The browser
  // calls the FastAPI backend directly, using the absolute URL baked
  // in at build time from NEXT_PUBLIC_API_URL (see components/lib/api.ts).
  // The backend is deployed separately — Railway or Render — because
  // Vercel serverless functions can't host the stateful SQLite/Postgres
  // pipeline this backend needs.
};

module.exports = nextConfig;
