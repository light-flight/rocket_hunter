import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Shown on screen so a manager can tell which version is installed. Comes from the Docker
// build (builder args in config/deploy.yml): a build-time stamp would change the bundle and
// sw.js on every deploy and offer phones an update when nothing in the app changed.
const buildId = process.env.BUILD_ID ?? 'dev'

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
        theme_color: '#060607',
        background_color: '#060607',
        // Lets a Chrome tab on Android tell that the app is already installed
        // (navigator.getInstalledRelatedApps), so it does not offer to install it again.
        related_applications: [
          { platform: 'webapp', url: 'https://app.rocket-hunter.ru/manifest.webmanifest' },
        ],
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
        runtimeCaching: [
          {
            // The manager's photo. Its address changes with the photo, so a kept one is never stale.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname === '/api/avatar',
            handler: 'CacheFirst',
            options: { cacheName: 'avatar', expiration: { maxEntries: 4 } },
          },
        ],
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
