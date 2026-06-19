/**
 * Monoline inline SVG icons, ~20px, stroke = currentColor.
 * Parent sets color (the .ico rule uses var(--accent)).
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...props,
  };
}

// Automatic fallback — branching arrow rerouting
export function IconFallback(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7h7a5 5 0 0 1 5 5v0" />
      <path d="M4 17h7a5 5 0 0 0 5-5" />
      <path d="M16 4l4 3-4 3" />
      <path d="M16 14l4 3-4 3" />
    </svg>
  );
}

// Rate limiting — gauge
export function IconRateLimit(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="M12 18l4-5" />
      <circle cx="12" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

// Eight providers — grid of nodes
export function IconProviders(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M8 6h8M6 8v8M18 8v8M8 18h8" />
    </svg>
  );
}

// Drop-in compatible — plug
export function IconDropIn(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 3v5M15 3v5" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0V8Z" />
      <path d="M12 17v4" />
    </svg>
  );
}

// Zero retention — shield with slash
export function IconZeroRetention(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z" />
      <path d="M9 12h6" />
    </svg>
  );
}

// No signup — user with slash
export function IconNoSignup(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

// MIT licensed — document with check
export function IconLicense(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v4h4" />
      <path d="M9.5 14l2 2 3.5-4" />
    </svg>
  );
}

// Self-host — server stack
export function IconSelfHost(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="4" y="4" width="16" height="6" rx="1.5" />
      <rect x="4" y="14" width="16" height="6" rx="1.5" />
      <path d="M8 7h.01M8 17h.01" />
    </svg>
  );
}

// Free hosted — cloud
export function IconHosted(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 18a4 4 0 0 1-.5-7.97A5 5 0 0 1 16 9.5a3.5 3.5 0 0 1 1 6.86" />
      <path d="M7 18h9" />
    </svg>
  );
}

// Star — filled accent star for hero badge
export function IconStar(props: IconProps) {
  return (
    <svg
      {...base(props)}
      fill="currentColor"
      stroke="none"
      width={props.width ?? 13}
      height={props.height ?? 13}
    >
      <path d="M12 2.5l2.6 5.6 6.1.6-4.6 4.1 1.4 6L12 15.9 6.5 18.8l1.4-6L3.3 8.7l6.1-.6L12 2.5Z" />
    </svg>
  );
}
