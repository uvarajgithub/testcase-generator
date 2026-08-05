import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "retain-on-failure"
  },
  webServer: [
    { command: "npm.cmd run server", port: 8787, reuseExistingServer: true },
    { command: "npm.cmd run dev -- --host 127.0.0.1", port: 5174, reuseExistingServer: true }
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } }
  ]
});
