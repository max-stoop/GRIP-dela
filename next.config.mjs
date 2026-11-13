/** Azure (App Service) draait een zelfstandige server: node server.js, met het databaseschema erbij. */
const azure = process.env.NEXT_PUBLIC_GRIP_PLATFORM === 'azure';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // een eigen map voor de Azure-build in de tests, naast de gewone
  distDir: process.env.GRIP_DIST || '.next',
  // de commit waaruit gebouwd is; /api/versie geeft hem terug
  env: { GRIP_VERSIE: process.env.GRIP_VERSIE || 'lokaal' },
  ...(azure ? {
    output: 'standalone',
    outputFileTracingIncludes: { '/**': ['./azure/database/*.sql'] },
  } : {}),
  eslint: {
    // ESLint draait niet mee in de build; typecheck en tests wel (zie CI).
    ignoreDuringBuilds: true,
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
