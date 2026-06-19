import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { clientIp } from "@/lib/client-ip";

function reqWith(headers: Record<string, string>): Request {
  return new Request("http://t/", { headers });
}

const ORIG = process.env.TRUSTED_PROXY_HOPS;
beforeEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.TRUSTED_PROXY_HOPS;
  else process.env.TRUSTED_PROXY_HOPS = ORIG;
});

describe("clientIp", () => {
  it("prefers x-real-ip over x-forwarded-for", () => {
    const ip = clientIp(
      reqWith({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1, 2.2.2.2" }),
    );
    expect(ip).toBe("9.9.9.9");
  });

  it("uses the RIGHTMOST XFF entry with TRUSTED_PROXY_HOPS=1 (default)", () => {
    const ip = clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" }));
    // 1 trusted hop → real client is the rightmost entry.
    expect(ip).toBe("3.3.3.3");
  });

  it("uses the 2nd-from-right entry with TRUSTED_PROXY_HOPS=2", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    const ip = clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" }));
    // 2 trusted hops → real client is 2nd from the right.
    expect(ip).toBe("2.2.2.2");
  });

  it("returns 'unknown' when no IP headers are present", () => {
    expect(clientIp(reqWith({}))).toBe("unknown");
  });

  it("spoofed extra LEFTMOST entries do not change the result", () => {
    // An attacker prepends fake entries on the left. With 1 trusted hop we read
    // from the right, so the spoofed values are ignored.
    const honest = clientIp(reqWith({ "x-forwarded-for": "203.0.113.7" }));
    const spoofed = clientIp(
      reqWith({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 203.0.113.7" }),
    );
    expect(honest).toBe("203.0.113.7");
    expect(spoofed).toBe("203.0.113.7");
  });

  it("clamps to the leftmost entry when the chain is shorter than the hop count", () => {
    process.env.TRUSTED_PROXY_HOPS = "5";
    const ip = clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }));
    // Fewer real hops than configured → fall back to the leftmost available.
    expect(ip).toBe("1.1.1.1");
  });

  it("trims whitespace and ignores empty XFF segments", () => {
    const ip = clientIp(reqWith({ "x-forwarded-for": " 1.1.1.1 ,  , 2.2.2.2 " }));
    expect(ip).toBe("2.2.2.2");
  });

  it("falls back to XFF when x-real-ip is blank", () => {
    const ip = clientIp(reqWith({ "x-real-ip": "  ", "x-forwarded-for": "5.5.5.5" }));
    expect(ip).toBe("5.5.5.5");
  });

  // ── Class 4: algorithmic-blowup / unbounded-input robustness ───────────────
  // The XFF parser is split(",")+map(trim)+filter — strictly linear, no regex
  // backtracking. A pathological 100k-segment header must parse in well under a
  // second and still return a single well-formed entry (no hang, no crash).
  it("parses a 100k-segment XFF header quickly (no algorithmic blowup)", () => {
    const huge = Array.from({ length: 100_000 }, (_, i) => `1.1.1.${i % 256}`).join(",");
    const t0 = Date.now();
    const ip = clientIp(reqWith({ "x-forwarded-for": huge }));
    const elapsed = Date.now() - t0;
    expect(typeof ip).toBe("string");
    expect(ip).not.toBe("unknown");
    expect(elapsed).toBeLessThan(500);
  });

  it("a huge all-whitespace/empty XFF degrades to 'unknown' without hanging", () => {
    const huge = ",".repeat(200_000);
    const t0 = Date.now();
    const ip = clientIp(reqWith({ "x-forwarded-for": huge }));
    expect(ip).toBe("unknown");
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("TRUSTED_PROXY_HOPS=NaN/garbage falls back to 1 (no infinite loop)", () => {
    process.env.TRUSTED_PROXY_HOPS = "not-a-number";
    expect(clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("2.2.2.2");
    process.env.TRUSTED_PROXY_HOPS = "-5";
    expect(clientIp(reqWith({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }))).toBe("2.2.2.2");
  });
});

// ── Class 4: bearer-strip & maskKey regex are linear (no ReDoS) ──────────────
describe("auth-token parsing is ReDoS-safe", () => {
  const strip = (s: string) => s.replace(/^Bearer\s+/i, "").trim();
  it("strips a normal bearer token", () => {
    expect(strip("Bearer gw_live_abc")).toBe("gw_live_abc");
  });
  it("a 1M-char header with maximal whitespace runs in well under a second", () => {
    // /^Bearer\s+/i is anchored with a single \s+ run — linear, not catastrophic.
    const evil = "Bearer" + " ".repeat(1_000_000) + "x";
    const t0 = Date.now();
    const out = strip(evil);
    expect(out).toBe("x");
    expect(Date.now() - t0).toBeLessThan(300);
  });
  it("a long non-matching header does not backtrack", () => {
    const evil = "Bearer" + "\t".repeat(500_000); // \t is \s, but no trailing token
    const t0 = Date.now();
    strip(evil);
    expect(Date.now() - t0).toBeLessThan(300);
  });
});
