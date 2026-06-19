import Link from "next/link";

export const metadata = { title: "Terms — GatewayforAI" };

function LegalFooter() {
  return (
    <footer style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid var(--line)", fontSize: 13, color: "var(--muted)" }}>
      <Link href="/" style={{ color: "var(--muted)" }}>Home</Link>
      {" · "}
      <Link href="/privacy" style={{ color: "var(--muted)" }}>Privacy</Link>
      {" · "}
      <Link href="/terms" style={{ color: "var(--muted)" }}>Terms</Link>
      {" · "}
      <a href="https://github.com/eruo005-dev/gatewayforai-com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--muted)" }}>GitHub</a>
    </footer>
  );
}

export default function Terms() {
  return (
    <main className="container" style={{ maxWidth: 720, padding: "48px 24px" }}>
      <Link href="/" className="mono" style={{ color: "var(--muted)" }}>← gatewayforai</Link>
      <h1 style={{ marginTop: 16 }}>Terms</h1>
      <p style={{ color: "var(--muted)" }}>Plain English. No legalese.</p>

      <h2 style={{ fontSize: 20 }}>The service</h2>
      <p style={{ color: "var(--muted)" }}>
        GatewayforAI is an OpenAI-compatible gateway that routes LLM requests to providers
        using API keys you supply. It is provided &quot;as is&quot;, currently free, and in beta.
      </p>

      <h2 style={{ fontSize: 20 }}>Your responsibilities</h2>
      <p style={{ color: "var(--muted)" }}>
        You own your provider accounts, their billing, and their rate limits. You are
        responsible for the content of requests sent through your gateway and for complying
        with each provider&apos;s terms of service and applicable law.
      </p>

      <h2 style={{ fontSize: 20 }}>Our commitments and limits</h2>
      <p style={{ color: "var(--muted)" }}>
        We do not store your prompts or responses. We may rate-limit or disable gateways
        that abuse the service. No warranty or uptime guarantee is provided. To the maximum
        extent permitted by law, our liability is limited to zero — this is a free service.
      </p>

      <h2 style={{ fontSize: 20 }}>Changes</h2>
      <p style={{ color: "var(--muted)" }}>
        We may update these terms. Material changes will be announced on this page.
      </p>

      <h2 style={{ fontSize: 20 }}>Contact</h2>
      <p style={{ color: "var(--muted)" }}>
        Questions and issues via GitHub:{" "}
        <a
          href="https://github.com/eruo005-dev/gatewayforai-com/issues"
          style={{ color: "var(--accent)" }}
        >
          github.com/eruo005-dev/gatewayforai-com/issues
        </a>
        . Operated by an independent developer.
      </p>
      <LegalFooter />
    </main>
  );
}
