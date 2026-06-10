import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { sentryVitePlugin } from "@sentry/vite-plugin";

// Sentry source-map upload is OPT-IN: it only runs when SENTRY_AUTH_TOKEN is set
// (e.g. in CI / Vercel). Local builds without a token are unaffected — no plugin,
// no source maps, no failure.
const sentryEnabled = !!process.env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  plugins: [
    react(),
    sentryEnabled && sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
    }),
  ].filter(Boolean),
  build: {
    // Only emit source maps when we're going to upload them to Sentry.
    sourcemap: sentryEnabled,
  },
  optimizeDeps: {
    exclude: ["@supabase/supabase-js"]
  }
});
