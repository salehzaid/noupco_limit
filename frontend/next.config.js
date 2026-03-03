/** @type {import('next').NextConfig} */
const API_PROXY_TARGET = (process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "https://noupco-limit.onrender.com").replace(/\/+$/, "");

const nextConfig = {
  async redirects() {
    return [
      { source: "/favicon.ico", destination: "/favicon.svg", permanent: false },
      { source: "/limit", destination: "/hospitals/1/departments", permanent: false },
      { source: "/limits", destination: "/hospitals/1/departments", permanent: false },
    ];
  },

  async rewrites() {
    return [
      { source: "/health", destination: `${API_PROXY_TARGET}/health` },
      { source: "/api/:path*", destination: `${API_PROXY_TARGET}/api/:path*` },
    ];
  },
};

module.exports = nextConfig;
