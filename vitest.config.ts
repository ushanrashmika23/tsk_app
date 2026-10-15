import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests must never reach the real Cloudflare database or the Groq API:
    // a missing credential in a test is a bug in the test, not a skip.
    env: {
      APP_TIMEZONE: "Asia/Colombo",
    },
    reporters: ["default"],
  },
});
