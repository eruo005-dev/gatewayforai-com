"use client";

import { useEffect, useRef, useState } from "react";

const SCRIPT = [
  { cls: "c-dim", text: "$ " },
  { cls: "c-cmd", text: "curl https://gatewayforai.com/v1/chat/completions \\\n" },
  { cls: "c-cmd", text: '    -H "Authorization: Bearer gw_live_x9K2…" \\\n' },
  { cls: "c-cmd", text: '    -d \'{"model": "auto", "messages": [{"role": "user", "content": "hi"}]}\'\n\n' },
  { cls: "c-dim", text: "< HTTP/2 200\n" },
  { cls: "c-acc", text: "< x-gateway-provider: groq\n" },
  { cls: "c-acc", text: "< x-gateway-fallback-count: 1\n" },
  { cls: "c-dim", text: "< x-gateway-latency-ms: 312\n\n" },
  { cls: "c-cmd", text: '{"choices": [{"message": {"content": "Hello! …"}}]}' },
];

export default function Terminal() {
  const [count, setCount] = useState(0);
  const total = useRef(SCRIPT.reduce((n, s) => n + s.text.length, 0));

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCount(total.current);
      return;
    }
    if (count >= total.current) return;
    const t = setTimeout(() => setCount((c) => c + 1), 18);
    return () => clearTimeout(t);
  }, [count]);

  let remaining = count;
  const visible = SCRIPT.map((seg) => {
    const take = Math.max(0, Math.min(seg.text.length, remaining));
    remaining -= take;
    return { ...seg, text: seg.text.slice(0, take) };
  });

  return (
    <div className="terminal">
      <div className="bar"><i /><i /><i /></div>
      <pre>
        {visible.map((seg, i) => (
          <span key={i} className={seg.cls}>{seg.text}</span>
        ))}
        <span className="cursor" />
      </pre>
    </div>
  );
}
