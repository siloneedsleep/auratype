import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AuraType AI',
    short_name: 'AuraType',
    description: 'Không gian luyện gõ tiếng Việt và tiếng Anh.',
    start_url: '/',
    display: 'standalone',
    background_color: '#111312',
    theme_color: '#111312',
    icons: [
      {
        src: '/brand/auratype-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/brand/auratype-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
