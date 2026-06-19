import Link from "next/link";
import LegalFooter from "@/components/LegalFooter";

export const metadata = {
  title: "Privacy — GatewayforAI",
  description:
    "GatewayforAI is a pipe, not a database. We never store your prompts or responses — only encrypted provider keys, a hash of your gateway key, and daily usage counters.",
  alternates: { canonical: "/privacy" },
};

export default function Privacy() {
  return (
    <main className="container legal" style={{ maxWidth: 720, padding: "48px 24px" }}>
      <Link href="/" className="mono" style={{ color: "var(--muted)" }}>← gatewayforai</Link>
      <h1>Privacy</h1>
      <p className="legal-updated">Last updated: 2026-06-19</p>
      <p>The short version: we are a pipe, not a database.</p>

      <h2>What we never store</h2>
      <p>
        Your prompts, your model responses, your users&apos; data. Requests stream through the
        gateway to the provider you chose and are gone. There is no logging of request or
        response bodies, anywhere, ever. Don&apos;t take our word for it — the gateway is open
        source; verify at{" "}
        <a
          href="https://github.com/eruo005-dev/gatewayforai-com"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--accent)" }}
        >
          github.com/eruo005-dev/gatewayforai-com
        </a>.
      </p>

      <h2>What we store</h2>
      <p>
        (1) Your provider API keys, encrypted with AES-256-GCM — decrypted only in memory to
        call providers on your behalf, never logged, never displayed after creation.
        (2) A SHA-256 hash of your gateway key — we cannot recover the key itself.
        (3) Daily aggregate counters (request / error / fallback counts per provider),
        kept 30 days, used only to show you your usage.
      </p>

      <h2>Deletion</h2>
      <p>
        Delete your config at <Link href="/manage" style={{ color: "var(--accent)" }}>/manage</Link> any
        time — keys and counters are removed immediately and irrecoverably.
      </p>

      <h2>Third parties</h2>
      <p>
        Hosting: Vercel. Storage: Upstash (Redis). Your traffic additionally reaches the LLM
        providers you configured, under their terms.
      </p>
      <LegalFooter />
    </main>
  );
}
