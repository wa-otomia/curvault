// Dedicated viewer for the GP applet / package listing of a card.
//
// Wraps `inspect_card` (which already runs `gp --info --list`) but auto-
// fetches as soon as the user picks a reader, so the applets are visible
// without clicking through Readers > Inspect.

import { useEffect, useState } from "react";
import { listReaders, inspectCard } from "../lib/api";
import type { Reader, CardInfo, Applet } from "../types";
import LoadingOverlay from "../components/LoadingOverlay";

function tagColor(kind: Applet["kind"]): { bg: string; fg: string; label: string } {
  switch (kind) {
    case "ISD": return { bg: "rgba(54,197,255,0.18)", fg: "#9bd9ff", label: "ISD" };
    case "APP": return { bg: "rgba(76,175,122,0.18)", fg: "#7be3ad", label: "APP" };
    case "PKG": return { bg: "rgba(212,161,60,0.18)", fg: "#f0c971", label: "PKG" };
    default:    return { bg: "rgba(255,255,255,0.10)", fg: "#cccccc", label: kind };
  }
}

function stateColor(state: string): string {
  if (state.includes("OP_READY") || state.includes("INITIALIZED")) return "var(--warn)";
  if (state.includes("LOCKED") || state.includes("TERMINATED")) return "var(--error)";
  if (state.includes("SECURED") || state.includes("SELECTABLE") || state.includes("LOADED") || state.includes("INSTALLED")) return "var(--ok)";
  return "var(--text-dim)";
}

export default function AppletsView() {
  const [readers, setReaders] = useState<Reader[]>([]);
  const [reader, setReader] = useState("");
  const [card, setCard] = useState<CardInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listReaders().then((rs) => {
      setReaders(rs);
      const r = rs.find((r) => r.hasCard);
      if (r) setReader(r.name);
    }).catch((e) => setErr(String(e)));
  }, []);

  useEffect(() => {
    if (!reader) return;
    setBusy(true);
    setErr(null);
    setCard(null);
    inspectCard(reader)
      .then(setCard)
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  }, [reader]);

  const isds  = card?.applets.filter((a) => a.kind === "ISD") ?? [];
  const apps  = card?.applets.filter((a) => a.kind === "APP") ?? [];
  const pkgs  = card?.applets.filter((a) => a.kind === "PKG") ?? [];

  return (
    <>
      <LoadingOverlay show={busy} label="Reading card…" />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Installed Applets</h2>
        <button onClick={() => reader && inspectCard(reader).then(setCard).catch((e) => setErr(String(e)))}>
          Refresh
        </button>
      </div>

      <div className="card">
        <div className="field">
          <label>Reader</label>
          <select value={reader} onChange={(e) => setReader(e.target.value)}>
            <option value="">— pick reader with a card —</option>
            {readers.filter((r) => r.hasCard).map((r) => (
              <option key={r.name} value={r.name}>{r.name}</option>
            ))}
          </select>
        </div>
        {card && (
          <div className="row" style={{ marginTop: ".5rem", fontSize: 12, color: "var(--text-dim)" }}>
            <span><strong>ATR:</strong> <code>{card.atr}</code></span>
            {card.gpVersion && <span><strong>GP:</strong> {card.gpVersion}</span>}
            {card.cplc && <span><strong>Chip:</strong> fab={card.cplc.icFabricator} sn={card.cplc.icSerialNumber}</span>}
          </div>
        )}
      </div>

      {err && (
        <div className="card" style={{ borderColor: "var(--error)" }}>
          <pre>{err}</pre>
        </div>
      )}

      {busy && <div className="empty">Reading card…</div>}

      {card && card.applets.length === 0 && !busy && (
        <div className="empty">Card is empty (no Security Domain, applets, or packages found).</div>
      )}

      {card && [["Security Domain", isds], ["Applets", apps], ["Packages", pkgs]].map(
        ([title, list]) => {
          const items = list as Applet[];
          if (items.length === 0) return null;
          return (
            <div key={title as string} className="card">
              <h3>{title as string} ({items.length})</h3>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Kind</th>
                    <th>AID</th>
                    <th style={{ width: 140 }}>State</th>
                    <th>Parent / Privileges</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => {
                    const t = tagColor(a.kind);
                    return (
                      <tr key={a.kind + a.aid}>
                        <td>
                          <span style={{
                            background: t.bg, color: t.fg, padding: "0.1rem 0.4rem",
                            borderRadius: 3, fontSize: 11, fontWeight: 700,
                          }}>{t.label}</span>
                        </td>
                        <td><code>{a.aid}</code></td>
                        <td style={{ color: stateColor(a.state) }}>{a.state}</td>
                        <td style={{ fontSize: 12, color: "var(--text-dim)" }}>
                          {a.parent && <div><code>{a.parent}</code></div>}
                          {a.privileges && a.privileges.length > 0 && (
                            <div>{a.privileges.slice(0, 3).join(", ")}
                              {a.privileges.length > 3 && ` (+${a.privileges.length - 3})`}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        },
      )}
    </>
  );
}
