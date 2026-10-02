import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/*.png'],
      manifest: {
        name: 'K线查看器',
        short_name: 'K线查看器',
        description: 'OI 历史K线、CSV 上传与图表打标，支持手机查看',
        id: './',
        start_url: './',
        scope: './',
        lang: 'zh-CN',
        theme_color: '#0b0f1a',
        background_color: '#0b0f1a',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        cleanupOutdatedCaches: true,
        runtimeCaching: [{
          urlPattern: ({ url }) => url.pathname.includes('/data/oi-full/'),
          handler: 'NetworkFirst',
          options: {
            cacheName: 'kline-history-v1',
            networkTimeoutSeconds: 4,
            cacheableResponse: { statuses: [200] },
            expiration: { maxEntries: 40, maxAgeSeconds: 365 * 24 * 60 * 60 },
          },
        }],
      },
    }),
  ],
})
