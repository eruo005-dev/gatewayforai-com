import Link from "next/link";
import LegalFooter from "@/components/LegalFooter";

export const metadata = {
  title: "Terms — GatewayforAI",
  description:
    "Plain-English terms for GatewayforAI: an OpenAI-compatible gateway provided as-is and free. You own your provider accounts, billing, and the content of your requests.",
  alternates: { canonical: "/terms" },
};

export default function Terms() {
  return (
    <main className="container legal" style={{ maxWidth: 720, padding: "48px 24px" }}>
      <Link href="/" className="mono" style={{ color: "var(--muted)" }}>← gatewayforai</Link>
      <h1>Terms</h1>
      <p className="legal-updated">Last updated: 2026-06-19</p>
      <p>Plain English. No legalese.</p>

      <h2>The service</h2>
      <p>
        GatewayforAI is an OpenAI-compatible gateway that routes LLM requests to providers
        using API keys you supply. It is provided &quot;as is&quot;, currently free, and in beta.
      </p>

      <h2>Your responsibilities</h2>
      <p>
        You own your provider accounts, their billing, and their rate limits. You are
        responsible for the content of requests sent through your gateway and for complying
        with each provider&apos;s terms of service and applicable law.
      </p>

      <h2>Our commitments and limits</h2>
      <p>
        We do not store your prompts or responses. We may rate-limit or disable gateways
        that abuse the service. No warranty or uptime guarantee is provided. To the maximum
        extent permitted by law, our liability for any claim arising from your use of this
        free service is limited.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. Material changes will be announced on this page.
      </p>

      <h2>Contact</h2>
      <p>
        Questions and issues via GitHub:{" "}
        <a
          href="https://github.com/eruo005-dev/gatewayforai-com/issues"
          target="_blank"
          rel="noopener noreferrer"
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
