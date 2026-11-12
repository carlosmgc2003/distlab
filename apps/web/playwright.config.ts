import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // The existing suite reads English text (ADR-007); i18n.spec.ts covers the other locales explicitly.
  use: { baseURL: "http://127.0.0.1:4173", browserName: "chromium", locale: "en-US" },
  webServer: {
    command: "npm run build && npm exec -- vite preview --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});
