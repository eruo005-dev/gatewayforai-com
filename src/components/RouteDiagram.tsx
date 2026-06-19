const PROVIDERS = [
  "OpenAI", "Anthropic", "Gemini", "Groq", "Mistral", "Together", "DeepSeek", "OpenRouter",
];

// Vertical positions for the 8 provider nodes
const ys = [36, 84, 132, 180, 228, 276, 324, 372];
// Path from gateway (360,204) to provider node x=590
const path = (y: number) => `M 372 204 C 470 204, 480 ${y}, 588 ${y}`;
const DOWN = 2; // index of the provider that "dies" (Gemini row)

export default function RouteDiagram() {
  return (
    <svg
      viewBox="0 0 720 408"
      role="img"
      aria-label="Requests flow through the gateway to 8 providers; when one fails, traffic reroutes automatically"
      style={{ width: "100%", maxWidth: 760, display: "block", margin: "48px auto 0" }}
    >
      <defs>
        <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* client → gateway line */}
      <path d="M 132 204 L 288 204" stroke="#222228" strokeWidth="1.5" fill="none" />
      {/* gateway → provider curves */}
      {ys.map((y, i) => (
        <path key={i} d={path(y)} stroke="#222228" strokeWidth="1.5" fill="none" />
      ))}

      {/* client node */}
      <rect x="40" y="186" width="92" height="36" rx="8" fill="#101013" stroke="#222228" />
      <text x="86" y="208" textAnchor="middle" fill="#8e8e97" fontSize="12" fontFamily="var(--mono)">
        gw_live_…
      </text>

      {/* gateway node */}
      <rect x="288" y="178" width="84" height="52" rx="10" fill="#101013" stroke="#00ff88" filter="url(#glow)" />
      <text x="330" y="201" textAnchor="middle" fill="#00ff88" fontSize="11" fontFamily="var(--mono)">
        GATEWAY
      </text>
      <text x="330" y="216" textAnchor="middle" fill="#8e8e97" fontSize="9" fontFamily="var(--mono)">
        route · limit · retry
      </text>

      {/* provider nodes — the DOWN node's color-flash is driven by a CSS animation
          (class rd-flash-*) instead of SMIL <animate>, so the prefers-reduced-motion
          block in globals.css can disable it (SMIL cannot be CSS-gated). */}
      {PROVIDERS.map((name, i) => (
        <g key={name}>
          <rect
            x="588" y={ys[i] - 14} width="106" height="28" rx="7" fill="#101013"
            stroke="#222228"
            className={i === DOWN ? "rd-flash-stroke" : undefined}
          />
          <text
            x="641" y={ys[i] + 4} textAnchor="middle" fill="#8e8e97" fontSize="11" fontFamily="var(--mono)"
            className={i === DOWN ? "rd-flash-fill" : undefined}
          >
            {name}
          </text>
        </g>
      ))}

      {/* steady pulses to healthy providers */}
      {[0, 1, 4, 6].map((target, i) => (
        <circle key={target} r="3.5" fill="#00ff88" filter="url(#glow)" className="rd-pulse">
          <animateMotion dur="2.6s" begin={`${i * 0.65}s`} repeatCount="indefinite"
            path={path(ys[target])} />
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.9;1"
            dur="2.6s" begin={`${i * 0.65}s`} repeatCount="indefinite" />
        </circle>
      ))}

      {/* client → gateway feed pulses */}
      <circle r="3.5" fill="#00ff88" filter="url(#glow)" className="rd-pulse">
        <animateMotion dur="1.3s" repeatCount="indefinite" path="M 132 204 L 288 204" />
      </circle>

      {/* the reroute story: pulse heads to the DOWN provider in the first half of
          the 8s cycle, then visibly takes the next path during the outage window */}
      <circle r="3.5" fill="#00ff88" filter="url(#glow)" className="rd-pulse">
        <animateMotion dur="2s" begin="0s;reroute-a.end+6s" id="reroute-ok" path={path(ys[DOWN])} />
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.9;1" dur="2s"
          begin="0s;reroute-a.end+6s" />
      </circle>
      <circle r="3.5" fill="#00ff88" filter="url(#glow)" className="rd-pulse">
        <animateMotion dur="2s" begin="reroute-ok.end+2s" id="reroute-a" path={path(ys[DOWN + 1])} />
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.9;1" dur="2s"
          begin="reroute-ok.end+2s" />
      </circle>
    </svg>
  );
}
