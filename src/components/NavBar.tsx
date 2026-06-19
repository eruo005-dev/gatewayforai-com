"use client";

import Link from "next/link";
import { useState } from "react";

const LINKS = (
  <>
    <a href="#features">Features</a>
    <a href="#how">How it works</a>
    <a href="#faq">FAQ</a>
    <a
      href="https://github.com/eruo005-dev/gatewayforai-com"
      target="_blank"
      rel="noopener noreferrer"
    >
      GitHub
    </a>
    <Link href="/manage">Manage</Link>
    <Link href="/start" style={{ color: "var(--accent)" }}>Get started →</Link>
  </>
);

export default function NavBar() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="nav">
      <Link href="/" className="logo">gateway<span>for</span>ai</Link>

      <div className="links links-desktop">{LINKS}</div>

      <button
        type="button"
        className="nav-toggle"
        aria-label="Toggle navigation menu"
        aria-expanded={open}
        aria-controls="nav-mobile"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>

      {open && (
        <div id="nav-mobile" className="links links-mobile" onClick={() => setOpen(false)}>
          {LINKS}
        </div>
      )}
    </nav>
  );
}
