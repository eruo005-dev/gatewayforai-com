"use client";

import { useEffect, useRef, useState } from "react";

interface CopyButtonProps {
  value: string;
  /** Label when idle. Defaults to "Copy". */
  label?: string;
  /** Extra class names appended to the base ".btn" classes. */
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Copy-to-clipboard button that flips to "Copied ✓" for ~2s.
 * Reused for gateway keys and code snippets across /start and /manage.
 */
export default function CopyButton({ value, label = "Copy", className = "", style }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      /* clipboard unavailable — still show feedback */
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      className={`btn ${className}`.trim()}
      style={style}
      onClick={copy}
      aria-live="polite"
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
