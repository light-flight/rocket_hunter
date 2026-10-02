import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Shown on screen so a manager can tell which version is installed.
const buildId = `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`

// https://vite.dev/config/
export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Never reload the app under the manager's hands; a new version is applied by a button.
      registerType: 'prompt',
      manifest: {
        // The app's identity on the phone. Changing id, scope or start_url after
        // managers have installed it means reinstalling and losing local data.
        // iPhone also takes the name and icon at install time and never refreshes them,
        // so the final icon must ship before managers install the app for real work.
        id: '/',
        scope: '/',
        start_url: '/',
        name: 'Rocket Hunter',
        short_name: 'Rocket Hunter',
        lang: 'ru',
        display: 'standalone',
        theme_color: '#0b0f14',
        background_color: '#0b0f14',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The default list has no images or fonts; anything missing here is missing offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // Paths answered by Rails, not by the React shell. Installed phones keep this
        // list, so new server-side pages must live under one of these prefixes.
        navigateFallbackDenylist: [/^\/(api|rails|up)([/?]|$)/],
      },
    }),
  ],
  server: {
    proxy: {
      // Same origin for the browser in development, as in production. Keep changeOrigin off
      // so Rails sees the same Host as the browser's Origin.
      '/api': 'http://127.0.0.1:3000',
    },
  },
})
