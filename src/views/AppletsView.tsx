// Dedicated viewer for the GP applet / package listing of a card.
//
// Auto-fetches on reader selection so the applets are visible without
// the user clicking through Readers > Inspect. Each non-protected row
// gets a Delete action that runs `gp --uninstall <AID>` against the
// selected reader and GP key — protected rows (ISD/SSD, the javacard
// standard packages) keep the action greyed out so the user cannot
// brick the card from the UI.

import { useEffect, useState } from "react";
import {
  listReaders,
  listGpKeys,
  inspectCard,
  uninstallApplet,
} from "../lib/api";
import type { Reader, CardInfo, Applet, GpKeyHandle } from "../types";
import LoadingOverlay from "../components/LoadingOverlay";
import { aidName, isProtectedAid } from "../lib/aids";
import { confirmAction } from "../lib/dialog";

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

/** True if the row's AID + kind combination should be protected from
 *  deletion. ISD/SSD rows are always protected regardless of catalogue
 *  membership. */
function isProtectedRow(a: Applet): boolean {
  if (a.kind === "ISD") return true;
  return isProtectedAid(a.aid);
}

export default function AppletsView() {
  const [readers, setReaders] = useState<Reader[]>([]);
  const [keys, setKeys] = useState<GpKeyHandle[]>([]);
  const [reader, setReader] = useState("");
  const [gpKeyId, setGpKeyId] = useState("");
  const [card, setCard] = useState<CardInfo | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setBusy(true);
    Promise.all([listReaders(), listGpKeys()])
      .then(([rs, ks]) => {
        setReaders(rs);
        setKeys(ks);
        const r = rs.find((r) => r.hasCard);
        if (r) setReader(r.name);
        else setBusy(false);
      })
      .catch((e) => { setErr(String(e)); setBusy(false); });
  }, []);

  const refreshCard = async (r = reader) => {
    if (!r) return;
    setBusy(true);
    setErr(null);
    try {
      setCard(await inspectCard(r));
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (reader) refreshCard(reader);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reader]);

  const onDelete = async (a: Applet) => {
    if (!reader) return;
    if (isProtectedRow(a)) return;
    const name = aidName(a.aid) ?? a.aid;
    if (!(await confirmAction(
      `Uninstall ${a.kind} '${name}'?\n\n` +
      `AID: ${a.aid}\n` +
      `This calls gp --uninstall and removes the package and every applet inside it.\n` +
      `This action is irreversible.`,
      { title: "Uninstall applet", danger: true, okLabel: "Uninstall" },
    ))) return;

    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const r = await uninstallApplet(reader, gpKeyId || null, a.aid);
      if (r.exitCode !== 0) {
        setErr(`gp --uninstall exited ${r.exitCode}: ${r.stderr || r.stdout}`);
      } else {
        setNotice(`Uninstalled ${name}.`);
        await refreshCard();
      }
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const isds = card?.applets.filter((a) => a.kind === "ISD") ?? [];
  const apps = card?.applets.filter((a) => a.kind === "APP") ?? [];
  const pkgs = card?.applets.filter((a) => a.kind === "PKG") ?? [];

  return (
    <>
      <LoadingOverlay show={busy} label="Reading card…" />

      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Installed Applets</h2>
        <button onClick={() => refreshCard()} disabled={!reader || busy}>Refresh</button>
      </div>

      <div className="card">
        <div className="row">
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label>Reader</label>
            <select value={reader} onChange={(e) => setReader(e.target.value)}>
              <option value="">— pick reader with a card —</option>
              {readers.filter((r) => r.hasCard).map((r) => (
                <option key={r.name} value={r.name}>{r.name}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label>GP key (for Delete)</label>
            <select value={gpKeyId} onChange={(e) => setGpKeyId(e.target.value)}>
              <option value="">Default test key (40 41 42 … 4F)</option>
              {keys.map((k) => {
                const parts: string[] = [];
                if (k.note) parts.push(k.note);
                parts.push(k.id);
                if (k.cardSerial) parts.push(`card ${k.cardSerial}`);
                return (
                  <option key={k.id} value={k.id} title={k.note ?? ""}>
                    {parts.join(" · ")}
                  </option>
                );
              })}
            </select>
          </div>
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
      {notice && (
        <div className="card" style={{ borderColor: "var(--ok)" }}>
          {notice}
        </div>
      )}

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
                    <th style={{ width: 90 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => {
                    const t = tagColor(a.kind);
                    const name = aidName(a.aid);
                    const protectedRow = isProtectedRow(a);
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
                        <td>
                          <button
                            className="danger"
                            disabled={busy || protectedRow}
                            onClick={() => onDelete(a)}
                            title={
                              protectedRow
                                ? "System component — uninstalling would brick the card"
                                : `gp --uninstall ${a.aid}`
                            }
                          >
                            Delete
                          </button>
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
