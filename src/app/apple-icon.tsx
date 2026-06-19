import { ImageResponse } from "next/og";

// Next.js metadata-file convention: served at /apple-icon and auto-injected as
// <link rel="apple-touch-icon" sizes="180x180" href="/apple-icon">. Same brand
// mark as icon.tsx at the 180px home-screen size with more padding and a thin
// green border so it reads well as a rounded iOS tile.
export const runtime = "edge";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0b",
          color: "#00ff88",
          fontFamily: "monospace",
          fontWeight: 700,
          fontSize: 96,
          letterSpacing: -4,
          // thin signal-green border inset from the tile edge
          border: "4px solid #00ff88",
          borderRadius: 36,
        }}
      >
        gw
      </div>
    ),
    size,
  );
}
