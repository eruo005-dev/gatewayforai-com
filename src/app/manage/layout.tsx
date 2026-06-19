import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Manage your gateway — GatewayforAI",
  description:
    "Load your gateway config to edit the fallback chain, change rate limits, manage sub-keys, view usage, and rotate or delete your key.",
  alternates: { canonical: "/manage" },
};

export default function ManageLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
