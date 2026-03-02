/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      { source: "/limit", destination: "/hospitals/1/departments", permanent: false },
      { source: "/limits", destination: "/hospitals/1/departments", permanent: false },
    ];
  },
};

module.exports = nextConfig;
