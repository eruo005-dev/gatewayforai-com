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
});
