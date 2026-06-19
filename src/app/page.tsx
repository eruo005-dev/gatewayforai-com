import Link from "next/link";
import RouteDiagram from "@/components/RouteDiagram";
import Terminal from "@/components/Terminal";

const FEATURES = [
  ["[~>]", "Automatic fallback", "A provider returns 429 or 500? The gateway fails over to the next provider in your chain before a single token streams back."],
  ["[##]", "Rate limiting", "Per-key sliding-window limits you control. Protect your budget from runaway loops and abusive clients."],
  ["[8x]", "Eight providers", "OpenAI, Anthropic, Gemini, Groq, Mistral, Together, DeepSeek, OpenRouter — one endpoint, one key."],
  ["[->]", "Drop-in compatible", "OpenAI SDK and Anthropic SDK compatible. Change the baseURL and the key. That is the whole migration."],
  ["[:|]", "Zero retention", "Your prompts and responses pass through and are gone. We store encrypted keys and counters — never content."],
  ["[no]", "No signup", "No account, no email, no sales call. Paste keys, get a gateway key, ship."],
] as const;

const FAQ = [
  ["Is my OpenAI/Anthropic key safe?", "Keys are encrypted with AES-256-GCM before they touch storage and are only decrypted in-memory to call the provider you chose. They are never logged, never shown again, and you can rotate or delete your config at any time."],
  ["Do you store my prompts?", "No. Requests and responses stream through the gateway and are not persisted. We keep aggregate counters (request counts per day) so you can see usage — never content."],
  ["What happens when a provider goes down?", "If your model is \"auto\", the gateway retries the next provider in your fallback chain on 429s, 5xx errors and timeouts — up to 3 hops. You get a x-gateway-fallback-count header telling you it happened."],
  ["Does streaming work?", "Yes. SSE streaming passes straight through, including for Anthropic models (translated to OpenAI chunk format on the fly)."],
  ["Is it free — and who pays?", "The gateway is free to use. You bring your own provider API keys (BYOK) and pay your providers directly — we never touch your billing. GatewayforAI is built and operated by an independent developer; BYOK keeps operating costs near zero, so there is nothing to charge you. The entire codebase is open source (MIT) on GitHub. Self-host it and it is free in every sense: your infrastructure, your keys, your data."],
  ["I lost my gateway key.", "Keys cannot be recovered (we only store a hash). Create a new config at /start — it takes 30 seconds."],
  ["What happens if someone steals my gateway key?", "They can make requests through your configured providers (spending your provider credits) until you act — they can never read your raw provider keys, which are encrypted and never returned by any endpoint. Rotate or delete the config at /manage the moment you suspect a leak."],
  ["Does fallback work mid-stream?", "Fallback triggers on errors and timeouts before the first token — a provider that accepts the request but never produces output (a stream that dies at birth) fails over to the next provider automatically. Once output starts, the stream is committed and passes through; a connection that dies mid-stream is not retried (yet)."],
  ["Can I self-host it?", "Absolutely — that's the point. One-click deploy to Vercel plus a free Upstash Redis database and you have your own private gateway. The hosted instance runs the exact same open-source code. See the README on GitHub for the deploy button and setup."],
] as const;

export default function Home() {
  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="container">
        <nav className="nav">
          <Link href="/" className="logo">gateway<span>for</span>ai</Link>
          <div className="links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#faq">FAQ</a>
            <a href="https://github.com/eruo005-dev/gatewayforai-com" target="_blank" rel="noopener noreferrer">GitHub</a>
            <Link href="/manage">Manage</Link>
            <Link href="/start" style={{ color: "var(--accent)" }}>Get started →</Link>
          </div>
        </nav>
      </div>

      <main id="main">
      <div className="container">
        <section className="hero">
          <a
            href="https://github.com/eruo005-dev/gatewayforai-com"
            className="oss-badge"
            target="_blank"
            rel="noopener noreferrer"
          >
            ★ Free &amp; open source · MIT licensed
          </a>
          <h1>One endpoint.<br />Eight providers.<br /><em>Failover built in.</em></h1>
          <p className="sub">
            An OpenAI-compatible LLM gateway with automatic fallback routing and
            rate limiting. Bring your own keys. No signup, no markup, no stored prompts.
          </p>
          <div className="cta-row">
            <Link href="/start" className="btn primary">Create your gateway — 30s</Link>
            <a href="#how" className="btn">See how it works</a>
            <a
              href="https://github.com/eruo005-dev/gatewayforai-com"
              className="btn"
              target="_blank"
              rel="noopener noreferrer"
            >Star on GitHub →</a>
          </div>
          <RouteDiagram />
        </section>
      </div>

      <section className="section" id="demo">
        <div className="container">
          <span className="kicker">live behavior</span>
          <h2>Watch a failover happen</h2>
          <p className="lead">OpenAI rate-limited this request. Nobody noticed.</p>
          <Terminal />
        </div>
      </section>

      <section className="section" id="features">
        <div className="container">
          <span className="kicker">features</span>
          <h2>Infrastructure your LLM calls deserve</h2>
          <p className="lead">Everything between your app and the model APIs, handled.</p>
          <div className="grid">
            {FEATURES.map(([ico, title, body]) => (
              <div className="card" key={title}>
                <span className="ico">{ico}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <span className="kicker">providers</span>
          <h2>Route across all of them</h2>
          <p className="lead">Mix any providers you have keys for. Order them however you like.</p>
          <div className="providers">
            {["OpenAI", "Anthropic", "Google Gemini", "Groq", "Mistral", "Together", "DeepSeek", "OpenRouter"].map((p) => (
              <span key={p}>{p}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="opensource">
        <div className="container">
          <span className="kicker">open source</span>
          <h2>Free forever, yours to run</h2>
          <p className="lead">The code is public, the hosted instance is free, and you can run your own. Pick whichever works for you.</p>
          <div className="grid">
            <div className="card">
              <span className="ico">[MIT]</span>
              <h3>MIT licensed</h3>
              <p>Use it, fork it, host it, build a business on it. No strings.</p>
            </div>
            <div className="card">
              <span className="ico">[^v]</span>
              <h3>Self-host in one click</h3>
              <p>Deploy your own instance to Vercel with the button in the README. Bring your own Upstash Redis (free tier). Your keys, your infra.</p>
            </div>
            <div className="card">
              <span className="ico">[**]</span>
              <h3>Or use the free hosted instance</h3>
              <p>No signup, BYOK, nothing to pay us. The public instance is the same code you see on GitHub.</p>
            </div>
          </div>
          <div className="cta-row" style={{ marginTop: 40 }}>
            <a
              href="https://github.com/eruo005-dev/gatewayforai-com"
              className="btn primary"
              target="_blank"
              rel="noopener noreferrer"
            >View source on GitHub →</a>
            <a
              href="https://github.com/eruo005-dev/gatewayforai-com#readme"
              className="btn"
              target="_blank"
              rel="noopener noreferrer"
            >Read the docs →</a>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="container">
          <span className="kicker">how it works</span>
          <h2>Shipping in three steps</h2>
          <p className="lead">No account. The gateway key is the account.</p>
          <div className="steps">
            <div className="step">
              <h3>Paste your provider keys</h3>
              <p style={{ color: "var(--muted)", fontSize: 14.5 }}>
                Any subset of the 8 providers. Each key is validated live, encrypted
                with AES-256-GCM, and never shown again.
              </p>
            </div>
            <div className="step">
              <h3>Order your fallback chain</h3>
              <p style={{ color: "var(--muted)", fontSize: 14.5 }}>
                Decide who answers first and who catches the failure. Set your
                rate limit. Get one gw_live_ key.
              </p>
            </div>
            <div className="step">
              <h3>Change two lines of code</h3>
              <p style={{ color: "var(--muted)", fontSize: 14.5 }}>
                Point baseURL at gatewayforai.com/v1, use your gateway key, set
                model to &quot;auto&quot;. Done.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="faq">
        <div className="container">
          <span className="kicker">faq</span>
          <h2>Fair questions</h2>
          <p className="lead">The things you should ask anyone proxying your API keys.</p>
          <div className="faq">
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
      </main>

      <footer>
        <div className="container">
          <span className="mono">gateway<span style={{ color: "var(--accent)" }}>for</span>ai © 2026</span>
          <span>
            <Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · <a href="https://github.com/eruo005-dev/gatewayforai-com" target="_blank" rel="noopener noreferrer">GitHub</a> · <a href="https://github.com/eruo005-dev/gatewayforai-com/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a> · <Link href="/api/health">Status</Link> · <Link href="/start">Get started</Link> · <Link href="/manage">Manage</Link>
          </span>
        </div>
      </footer>
    </>
  );
}
