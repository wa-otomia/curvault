// Dedicated viewer for the GP applet / package listing of a card.
//
// Wraps `inspect_card` (which already runs `gp --info --list`) but auto-
// fetches as soon as the user picks a reader, so the applets are visible
// without clicking through Readers > Inspect.

import { useEffect, useState } from "react";
import { listReaders, inspectCard } from "../lib/api";
import type { Reader, CardInfo, Applet } from "../types";
import LoadingOverlay from "../components/LoadingOverlay";

// Friendly-name catalogue for common AIDs. We try the longest matching
// prefix first so an applet instance AID still maps to its package name.
const AID_CATALOGUE: { prefix: string; name: string }[] = [
  // IsoApplet — most specific first
  { prefix: "F276A288BCFBA69D34F31001", name: "IsoApplet (instance)" },
  { prefix: "F276A288BCFBA69D34F310",   name: "IsoApplet (package)" },
  // FIDO
  { prefix: "A0000006472F0001",         name: "FIDO U2F applet" },
  { prefix: "A000000647",               name: "FIDO Alliance" },
  // GlobalPlatform card manager
  { prefix: "A0000001515350",           name: "GP SSD package" },
  { prefix: "A000000151",               name: "GlobalPlatform ISD" },
  // JavaCard framework / extensions
  { prefix: "A0000000620204",           name: "javacard.framework" },
  { prefix: "A0000000620202",           name: "javacardx.crypto" },
  { prefix: "A0000000620201",           name: "javacard.security" },
  { prefix: "A0000000620001",           name: "java.lang" },
  // PIV
  { prefix: "A000000308",               name: "PIV applet" },
  // Payment schemes (informational only — not typical on dev cards)
  { prefix: "A0000000041010",           name: "Mastercard credit/debit" },
  { prefix: "A0000000031010",           name: "Visa credit/debit" },
];

function aidName(aid: string): string | null {
  const clean = aid.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  // Sort by prefix length descending so the longest match wins.
  const sorted = [...AID_CATALOGUE].sort((a, b) => b.prefix.length - a.prefix.length);
  const hit = sorted.find((e) => clean.startsWith(e.prefix));
  return hit ? hit.name : null;
}

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
    setBusy(true);
    listReaders()
      .then((rs) => {
        setReaders(rs);
        const r = rs.find((r) => r.hasCard);
        if (r) setReader(r.name);
        else setBusy(false); // no card → no inspect → done
      })
      .catch((e) => { setErr(String(e)); setBusy(false); });
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
                    <th>Name / AID</th>
                    <th style={{ width: 140 }}>State</th>
                    <th>Parent / Privileges</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => {
                    const t = tagColor(a.kind);
                    const name = aidName(a.aid);
                    return (
                      <tr key={a.kind + a.aid}>
                        <td>
                          <span style={{
                            background: t.bg, color: t.fg, padding: "0.1rem 0.4rem",
                            borderRadius: 3, fontSize: 11, fontWeight: 700,
                          }}>{t.label}</span>
                        </td>
                        <td>
                          {name && (
                            <div style={{ color: "var(--accent)", fontWeight: 600, fontSize: 13 }}>
                              {name}
                            </div>
                          )}
                          <code style={{ fontSize: 11, color: name ? "var(--text-dim)" : "var(--text)" }}>
                            {a.aid}
                          </code>
                        </td>
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
