import { vi } from "vitest";

// 64 hex chars, valid AES-256 key for tests
process.env.MASTER_KEY = "ab".repeat(32);

// Route handlers import `after` from next/server to schedule post-response work
// (usage/token recording). Outside a Next.js request scope `after` throws, so
// stub it to run the callback synchronously and swallow any error — tests don't
// assert on the deferred work, they just need the handler to return cleanly.
vi.mock("next/server", () => ({
  after: (fn: () => void) => {
    try {
      fn();
    } catch {
      /* deferred work is best-effort; ignore */
    }
  },
}));
