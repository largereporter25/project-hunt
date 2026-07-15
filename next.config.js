/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Next.js dev server proxies /api/* to the Python serverless handler
  // running locally on :8000. In production, Vercel's routing layer (see
  // vercel.json) takes care of this automatically.
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${apiBase}/api/:path*`,
      },
      {
        source: "/healthz",
        destination: `${apiBase}/healthz`,
      },
    ];
  },
};

module.exports = nextConfig;
