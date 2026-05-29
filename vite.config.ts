import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// base './' => works both on a domain root (Netlify/Cloudflare) and on a
// GitHub Pages project subpath without further config.
export default defineConfig({
  base: './',
  resolve: { dedupe: ['react', 'react-dom'] },
  optimizeDeps: { include: ['react', 'react-dom', 'react/jsx-runtime', 'zustand', 'maplibre-gl'] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['jetlag.svg'],
      manifest: {
        name: 'Hide + Seek: Budapest',
        short_name: 'Hide + Seek',
        description: 'Jetlag Hide and Seek map for Budapest, rail transit only',
        lang: 'en',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'jetlag.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'jetlag.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,geojson}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/__/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'openfreemap-tiles',
              expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ]
      },
      devOptions: { enabled: false }
    })
  ]
})
