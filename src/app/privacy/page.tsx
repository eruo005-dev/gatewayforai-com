import Link from "next/link";

export const metadata = { title: "Privacy — GatewayforAI" };

export default function Privacy() {
  return (
    <div className="container" style={{ maxWidth: 720, padding: "48px 24px" }}>
      <Link href="/" className="mono" style={{ color: "var(--muted)" }}>← gatewayforai</Link>
      <h1 style={{ marginTop: 16 }}>Privacy</h1>
      <p style={{ color: "var(--muted)" }}>The short version: we are a pipe, not a database.</p>

      <h2 style={{ fontSize: 20 }}>What we never store</h2>
      <p style={{ color: "var(--muted)" }}>
        Your prompts, your model responses, your users&apos; data. Requests stream through the
        gateway to the provider you chose and are gone. There is no logging of request or
        response bodies, anywhere, ever.
      </p>

      <h2 style={{ fontSize: 20 }}>What we store</h2>
      <p style={{ color: "var(--muted)" }}>
        (1) Your provider API keys, encrypted with AES-256-GCM — decrypted only in memory to
        call providers on your behalf, never logged, never displayed after creation.
        (2) A SHA-256 hash of your gateway key — we cannot recover the key itself.
        (3) Daily aggregate counters (request / error / fallback counts per provider),
        kept 30 days, used only to show you your usage.
      </p>

      <h2 style={{ fontSize: 20 }}>Deletion</h2>
      <p style={{ color: "var(--muted)" }}>
        Delete your config at <Link href="/manage" style={{ color: "var(--accent)" }}>/manage</Link> any
        time — keys and counters are removed immediately and irrecoverably.
      </p>

      <h2 style={{ fontSize: 20 }}>Third parties</h2>
      <p style={{ color: "var(--muted)" }}>
        Hosting: Vercel. Storage: Upstash (Redis). Your traffic additionally reaches the LLM
        providers you configured, under their terms.
      </p>
    </div>
  );
}
