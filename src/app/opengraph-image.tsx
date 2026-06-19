import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "GatewayforAI — one endpoint, eight providers, failover built in";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          background: "#0a0a0b",
          padding: "80px 96px",
        }}
      >
        {/* accent bar */}
        <div
          style={{
            width: 64,
            height: 6,
            background: "#00ff88",
            borderRadius: 3,
            marginBottom: 40,
          }}
        />
        {/* monospace badge */}
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 18,
            color: "#00ff88",
            letterSpacing: 2,
            marginBottom: 24,
          }}
        >
          [gw] gatewayforai.com
        </div>
        {/* headline */}
        <div
          style={{
            fontFamily: "sans-serif",
            fontSize: 72,
            fontWeight: 800,
            color: "#f0f0f0",
            lineHeight: 1.1,
            marginBottom: 28,
          }}
        >
          GatewayforAI
        </div>
        {/* sub */}
        <div
          style={{
            fontFamily: "sans-serif",
            fontSize: 32,
            color: "#888",
            marginBottom: 40,
          }}
        >
          One endpoint. Eight providers. Failover built in.
        </div>
        {/* pills */}
        <div style={{ display: "flex", gap: 16 }}>
          {["free", "open source", "MIT"].map((tag) => (
            <div
              key={tag}
              style={{
                fontFamily: "monospace",
                fontSize: 16,
                color: "#00ff88",
                border: "1px solid #00ff88",
                borderRadius: 4,
                padding: "4px 14px",
              }}
            >
              {tag}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
