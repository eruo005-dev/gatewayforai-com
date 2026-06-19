import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create your gateway — GatewayforAI",
};

export default function StartLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
