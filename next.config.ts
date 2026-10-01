import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Assets in /public are content-stable by convention, so let the
        // browser and Vercel's edge hold them for a year. Combined with
        // next/image's immutable, content-hashed optimiser URLs, repeat
        // visits to the homepage cost effectively zero image bandwidth.
        // If you replace an image, change its filename so the URL changes.
        source: '/images/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value:
              'public, max-age=31536000, immutable, stale-while-revalidate=86400',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
