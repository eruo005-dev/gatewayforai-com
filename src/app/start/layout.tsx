import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create your gateway — GatewayforAI",
  description:
    "Paste your provider keys, order your fallback chain, set a rate limit, and get an OpenAI-compatible gateway key in about 30 seconds. No signup.",
  alternates: { canonical: "/start" },
};

export default function StartLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
