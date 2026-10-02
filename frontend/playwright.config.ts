import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run against the production build served by Rails, the same way
// the deployed app is served. localhost counts as a secure context, so the service worker runs.
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3100',
  },
  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command:
      'npm run build:rails && cd .. && bin/rails server -e test -b localhost -p 3100 --pid tmp/pids/e2e.pid',
    url: 'http://localhost:3100/up',
    reuseExistingServer: false,
    // Lets Puma exit cleanly and remove its pid file instead of being killed.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
})
