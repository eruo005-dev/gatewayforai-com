import Link from "next/link";

export default function LegalFooter() {
  return (
    <footer className="legal-footer">
      <Link href="/">Home</Link>
      {" · "}
      <Link href="/privacy">Privacy</Link>
      {" · "}
      <Link href="/terms">Terms</Link>
      {" · "}
      <a
        href="https://github.com/eruo005-dev/gatewayforai-com"
        target="_blank"
        rel="noopener noreferrer"
      >
        GitHub
      </a>
    </footer>
  );
}
