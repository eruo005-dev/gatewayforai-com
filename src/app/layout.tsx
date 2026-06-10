import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "GatewayforAI — One endpoint. Eight providers. Failover built in.",
  description:
    "OpenAI-compatible LLM gateway with automatic fallback routing and rate limiting. Bring your own keys. No signup.",
  metadataBase: new URL("https://gatewayforai.com"),
  openGraph: {
    title: "GatewayforAI — One endpoint. Eight providers. Failover built in.",
    description:
      "OpenAI-compatible LLM gateway with automatic fallback routing and rate limiting. Bring your own keys. No signup.",
    url: "https://gatewayforai.com",
    siteName: "GatewayforAI",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "GatewayforAI — One endpoint. Eight providers. Failover built in.",
    description:
      "OpenAI-compatible LLM gateway with automatic fallback routing and rate limiting. BYOK. No signup.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
