import { ImageResponse } from "next/og";

// Next.js metadata-file convention: this route is served at /icon and Next
// auto-injects <link rel="icon" type="image/png" sizes="32x32" href="/icon">
// into <head>. Renders a raster PNG (favicon.ico requests resolve here too)
// so the site emits a real raster icon, not only the static icon.svg.
export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // near-black rounded brand square
          background: "#0a0a0b",
          borderRadius: 6,
          // signal-green mono glyph, tight + large so it stays crisp at 32px
          color: "#00ff88",
          fontFamily: "monospace",
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: -1,
        }}
      >
        gw
      </div>
    ),
    size,
  );
}
