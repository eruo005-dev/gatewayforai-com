"use client";

import Link from "next/link";
import { useState } from "react";
import CopyButton from "@/components/CopyButton";
import ConfirmDialog from "@/components/ConfirmDialog";

type Pending =
  | { kind: "rotate" }
  | { kind: "delete" }
  | { kind: "revoke"; id: string; label: string }
  | null;

interface ConfigView {
  providers: Record<string, string>;
  fallbackChain: Array<{ provider: string; model: string }>;
  rateLimit: { rpm: number; tpm?: number };
  createdAt: string;
  usage: Array<Record<string, number | string>>;
}

interface SubKeyView {
  id: string;
  label: string;
  rpm?: number;
  tpm?: number;
  createdAt: string;
}

const RPM_OPTIONS = [10, 30, 60, 120, 300, 600, 1000];
const TPM_OPTIONS = [
  { value: 0, label: "Off (no token limit)" },
  { value: 10_000, label: "10k tokens / min" },
  { value: 50_000, label: "50k tokens / min" },
  { value: 100_000, label: "100k tokens / min" },
  { value: 500_000, label: "500k tokens / min" },
  { value: 1_000_000, label: "1M tokens / min" },
];

export default function Manage() {
  const [key, setKey] = useState("");
  const [cfg, setCfg] = useState<ConfigView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rotatedKey, setRotatedKey] = useState("");
  const [busy, setBusy] = useState(false);

  // Sub-keys panel state
  const [subKeys, setSubKeys] = useState<SubKeyView[] | null>(null);
  const [newSubLabel, setNewSubLabel] = useState("");
  const [newSubRpm, setNewSubRpm] = useState(0);
  const [newSubTpm, setNewSubTpm] = useState(0);
  const [newSubKey, setNewSubKey] = useState("");
  const [subBusy, setSubBusy] = useState(false);

  // Confirmation modal state
  const [pending, setPending] = useState<Pending>(null);

  async function call(method: string, path = "/api/config", body?: unknown) {
    const res = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${key.trim()}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message ?? "Request failed.");
    return json;
  }

  async function load() {
    setBusy(true); setError(""); setNotice(""); setSubKeys(null); setNewSubKey("");
    try {
      setCfg(await call("GET"));
      // Load sub-keys after config loads successfully
      const list = await call("GET", "/api/config/subkeys");
      setSubKeys(list);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      const { rpm, tpm } = cfg!.rateLimit;
      await call("PATCH", "/api/config", {
        fallbackChain: cfg!.fallbackChain,
        rateLimit: { rpm, ...(tpm && tpm > 0 ? { tpm } : {}) },
      });
      setNotice("Saved.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function rotate() {
    setBusy(true); setError("");
    try {
      const { gatewayKey } = await call("POST", "/api/config/rotate");
      setKey(gatewayKey);
      setRotatedKey(gatewayKey);
      setNotice("New key generated — copy it now, it is shown once.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function destroy() {
    setBusy(true); setError("");
    try { await call("DELETE"); setCfg(null); setKey(""); setNotice("Config deleted."); setSubKeys(null); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function move(i: number, dir: -1 | 1) {
    setCfg((c) => {
      if (!c) return c;
      const chain = [...c.fallbackChain];
      const j = i + dir;
      if (j < 0 || j >= chain.length) return c;
      [chain[i], chain[j]] = [chain[j], chain[i]];
      return { ...c, fallbackChain: chain };
    });
  }

  async function createSub() {
    setSubBusy(true); setError(""); setNewSubKey("");
    try {
      const body: Record<string, unknown> = { label: newSubLabel.trim() };
      if (newSubRpm > 0) body.rpm = newSubRpm;
      if (newSubTpm > 0) body.tpm = newSubTpm;
      const { gatewayKey } = await call("POST", "/api/config/subkeys", body);
      setNewSubKey(gatewayKey);
      setNewSubLabel(""); setNewSubRpm(0); setNewSubTpm(0);
      // Refresh list
      const list = await call("GET", "/api/config/subkeys");
      setSubKeys(list);
    } catch (e) { setError((e as Error).message); }
    finally { setSubBusy(false); }
  }

  async function revokeSub(id: string) {
    setSubBusy(true); setError("");
    try {
      await call("DELETE", "/api/config/subkeys", { id });
      const list = await call("GET", "/api/config/subkeys");
      setSubKeys(list);
    } catch (e) { setError((e as Error).message); }
    finally { setSubBusy(false); }
  }

  function runPending() {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.kind === "rotate") void rotate();
    else if (p.kind === "delete") void destroy();
    else if (p.kind === "revoke") void revokeSub(p.id);
  }

  // tiny inline-SVG sparkline of daily request counts
  function Sparkline({ data }: { data: number[] }) {
    if (data.length === 0) return null;
    const w = 320, h = 36, max = Math.max(1, ...data);
    const step = data.length > 1 ? w / (data.length - 1) : w;
    const pts = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`).join(" ");
    return (
      <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img"
        aria-label="Daily request volume over the last 30 days">
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5"
          strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <main className="container" style={{ maxWidth: 780, padding: "48px 24px" }}>
      <Link href="/" className="mono" style={{ color: "var(--muted)" }}>← gatewayforai</Link>
      <h1 style={{ marginTop: 16 }}>Manage your gateway</h1>

      <div className="panel">
        <div className="field">
          <label htmlFor="gwkey">gw key</label>
          <input
            id="gwkey"
            type="password"
            placeholder="gw_live_…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button className="btn" onClick={load} disabled={busy || !key.trim()}>Load</button>
        </div>
      </div>

      <div aria-live="polite">
        {notice && <p style={{ color: "var(--accent)", fontFamily: "var(--mono)", fontSize: 13 }}>{notice}</p>}
      </div>
      {rotatedKey && (
        <div>
          <div className="keybox">{rotatedKey}</div>
          <CopyButton value={rotatedKey} label="Copy key" />
        </div>
      )}
      <div aria-live="assertive">
        {error && <p className="error-text">{error}</p>}
      </div>

      {cfg && (
        <>
          <div className="panel">
            <h3>Providers</h3>
            <p className="hint">Keys are masked. To change a key, delete and re-create the config (or PATCH via API).</p>
            {Object.entries(cfg.providers).map(([p, masked]) => (
              <div className="field" key={p}>
                <label htmlFor={`masked-${p}`}>{p}</label>
                <input id={`masked-${p}`} value={masked} disabled />
              </div>
            ))}
          </div>

          <div className="panel">
            <h3>Fallback chain</h3>
            {cfg.fallbackChain.map((e, i) => (
              <div className="chain-row" key={`${e.provider}-${i}`}>
                <span className="order">{i + 1}</span>
                <span>{e.provider}/</span>
                <input
                  aria-label={`${e.provider} model`}
                  value={e.model}
                  onChange={(ev) =>
                    setCfg((c) => c && {
                      ...c,
                      fallbackChain: c.fallbackChain.map((x, j) =>
                        j === i ? { ...x, model: ev.target.value } : x),
                    })
                  }
                />
                <span className="arrows">
                  <button onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                </span>
              </div>
            ))}
            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="manage-rpm">RPM</label>
              <select
                id="manage-rpm"
                value={cfg.rateLimit.rpm}
                onChange={(e) =>
                  setCfg((c) => c && { ...c, rateLimit: { ...c.rateLimit, rpm: Number(e.target.value) } })
                }
              >
                {RPM_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n} requests / min</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="manage-tpm">TPM (tokens/min)</label>
              <select
                id="manage-tpm"
                value={cfg.rateLimit.tpm ?? 0}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setCfg((c) => {
                    if (!c) return c;
                    const { tpm: _removed, ...rest } = c.rateLimit;
                    return { ...c, rateLimit: val > 0 ? { ...rest, tpm: val } : rest };
                  });
                }}
              >
                {TPM_OPTIONS.map(({ value, label }) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <button className="btn primary" onClick={save} disabled={busy}>Save changes</button>
          </div>

          {/* Sub-keys panel */}
          <div className="panel">
            <h3>Sub-keys</h3>
            <p className="hint">
              Sub-keys (<span className="mono">gw_sub_…</span>) route through your providers but have their own rate-limit buckets and can be revoked individually. They cannot read or modify your config.
            </p>

            {subKeys && subKeys.length > 0 && (() => {
              const fmtTpm = (sk: SubKeyView) =>
                sk.tpm != null ? (sk.tpm >= 1_000_000 ? `${sk.tpm / 1_000_000}M` : `${sk.tpm / 1000}k`) : "parent";
              return (
                <>
                  <div className="table-scroll subkey-table" style={{ marginBottom: 16 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 480 }}>
                      <thead>
                        <tr style={{ color: "var(--muted)", textAlign: "left" }}>
                          <th style={{ padding: "4px 8px 4px 0" }}>Label</th>
                          <th style={{ padding: "4px 8px" }}>ID</th>
                          <th style={{ padding: "4px 8px" }}>RPM</th>
                          <th style={{ padding: "4px 8px" }}>TPM</th>
                          <th style={{ padding: "4px 8px" }}>Created</th>
                          <th style={{ padding: "4px 0 4px 8px" }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {subKeys.map((sk) => (
                          <tr key={sk.id} style={{ borderTop: "1px solid var(--line)" }}>
                            <td style={{ padding: "6px 8px 6px 0" }}>{sk.label}</td>
                            <td style={{ padding: "6px 8px", fontFamily: "var(--mono)", fontSize: 12 }}>{sk.id}</td>
                            <td style={{ padding: "6px 8px" }}>{sk.rpm ?? "parent"}</td>
                            <td style={{ padding: "6px 8px" }}>{fmtTpm(sk)}</td>
                            <td style={{ padding: "6px 8px", color: "var(--muted)" }}>{sk.createdAt.slice(0, 10)}</td>
                            <td style={{ padding: "6px 0 6px 8px" }}>
                              <button
                                className="btn btn-danger"
                                style={{ fontSize: 12, padding: "2px 8px" }}
                                disabled={subBusy}
                                onClick={() => setPending({ kind: "revoke", id: sk.id, label: sk.label })}
                              >
                                Revoke
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="subkey-cards">
                    {subKeys.map((sk) => (
                      <div className="subkey-card" key={sk.id}>
                        <div className="row"><strong>{sk.label}</strong>
                          <button
                            className="btn btn-danger"
                            style={{ fontSize: 12, padding: "2px 8px" }}
                            disabled={subBusy}
                            onClick={() => setPending({ kind: "revoke", id: sk.id, label: sk.label })}
                          >
                            Revoke
                          </button>
                        </div>
                        <div className="row"><span className="k">ID</span><span style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{sk.id}</span></div>
                        <div className="row"><span className="k">RPM</span><span>{sk.rpm ?? "parent"}</span></div>
                        <div className="row"><span className="k">TPM</span><span>{fmtTpm(sk)}</span></div>
                        <div className="row"><span className="k">Created</span><span>{sk.createdAt.slice(0, 10)}</span></div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
            {subKeys && subKeys.length === 0 && (
              <p className="hint" style={{ marginBottom: 16 }}>No sub-keys yet.</p>
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="field" style={{ margin: 0, flex: "1 1 180px" }}>
                <label htmlFor="sub-label">Label</label>
                <input
                  id="sub-label"
                  placeholder="ci-bot, read-only, …"
                  value={newSubLabel}
                  maxLength={40}
                  onChange={(e) => setNewSubLabel(e.target.value)}
                />
              </div>
              <div className="field" style={{ margin: 0, flex: "0 0 auto" }}>
                <label htmlFor="sub-rpm">RPM override</label>
                <select
                  id="sub-rpm"
                  value={newSubRpm}
                  onChange={(e) => setNewSubRpm(Number(e.target.value))}
                >
                  <option value={0}>Inherit parent</option>
                  {RPM_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n} req / min</option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ margin: 0, flex: "0 0 auto" }}>
                <label htmlFor="sub-tpm">TPM override</label>
                <select
                  id="sub-tpm"
                  value={newSubTpm}
                  onChange={(e) => setNewSubTpm(Number(e.target.value))}
                >
                  {TPM_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>{value === 0 ? "Inherit parent" : label}</option>
                  ))}
                </select>
              </div>
              <button
                className="btn primary"
                onClick={createSub}
                disabled={subBusy || !newSubLabel.trim()}
                style={{ flex: "0 0 auto" }}
              >
                Create sub-key
              </button>
            </div>

            {newSubKey && (
              <div style={{ marginTop: 16 }}>
                <p style={{ fontSize: 13, color: "var(--accent)", fontFamily: "var(--mono)" }}>
                  New sub-key — copy it now, shown once:
                </p>
                <div className="keybox">{newSubKey}</div>
                <CopyButton value={newSubKey} label="Copy key" />
              </div>
            )}
          </div>

          <div className="panel">
            <h3>Usage — last 30 days</h3>
            <p className="hint">Last 30 days · counters only, no request contents stored.</p>
            <Sparkline data={cfg.usage.map((d) => Number(d.requests) || 0)} />
            <div className="table-scroll">
              <pre className="usage-pre">
                {"date         requests  fallbacks  errors\n" +
                  cfg.usage
                    .map((d) =>
                      `${d.date}   ${String(d.requests).padStart(8)}  ${String(d.fallbacks).padStart(9)}  ${String(d.errors).padStart(6)}`)
                    .join("\n")}
              </pre>
            </div>
          </div>

          <div className="panel">
            <h3>Danger zone</h3>
            <p className="hint">Rotation invalidates the old key instantly. Deletion is permanent.</p>
            <button className="btn" onClick={() => setPending({ kind: "rotate" })} disabled={busy} style={{ marginRight: 10 }}>
              Rotate key
            </button>
            <button className="btn btn-danger" onClick={() => setPending({ kind: "delete" })} disabled={busy}>
              Delete config
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={pending?.kind === "rotate"}
        title="Rotate gateway key?"
        body="A new key is generated and the current key stops working immediately. Update any clients using the old key."
        confirmLabel="Rotate key"
        tone="default"
        onConfirm={runPending}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending?.kind === "delete"}
        title="Delete this config permanently?"
        body={<>This removes your encrypted provider keys, sub-keys, and usage counters. This cannot be undone. Type <span className="mono">DELETE</span> to confirm.</>}
        confirmLabel="Delete config"
        requireText="DELETE"
        onConfirm={runPending}
        onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending?.kind === "revoke"}
        title="Revoke sub-key?"
        body={pending?.kind === "revoke" ? `"${pending.label}" will stop working immediately. This cannot be undone.` : ""}
        confirmLabel="Revoke sub-key"
        onConfirm={runPending}
        onCancel={() => setPending(null)}
      />
    </main>
  );
}
