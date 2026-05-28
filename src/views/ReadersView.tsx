import { useEffect, useState } from "react";
import { listReaders, inspectCard } from "../lib/api";
import type { Reader, CardInfo } from "../types";
import LoadingOverlay from "../components/LoadingOverlay";

export default function ReadersView() {
  const [readers, setReaders] = useState<Reader[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [card, setCard] = useState<CardInfo | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    try {
      setReaders(await listReaders());
      setErr(null);
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const inspect = async (reader: string) => {
    setSelected(reader);
    setBusy(true);
    setCard(null);
    setErr(null);
    try {
      setCard(await inspectCard(reader));
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <LoadingOverlay show={busy} label={selected ? "Inspecting card…" : "Listing readers…"} />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Readers</h2>
        <button onClick={refresh}>Refresh</button>
      </div>

      <div className="card">
        {readers.length === 0 ? (
          <div className="empty">No PC/SC readers detected.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Reader</th>
                <th>Card</th>
                <th>ATR</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {readers.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.hasCard ? "present" : "—"}</td>
                  <td><code>{r.atr ?? "—"}</code></td>
                  <td>
                    <button disabled={!r.hasCard || busy} onClick={() => inspect(r.name)}>
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="card">
          <h3>Card on {selected}</h3>
          {busy && <p>Reading CPLC / applet list…</p>}
          {err && <pre style={{ color: "var(--error)" }}>{err}</pre>}
          {card && (
            <>
              <div className="row">
                <div>
                  <div style={{ color: "var(--text-dim)", fontSize: 12 }}>ATR</div>
                  <code>{card.atr}</code>
                </div>
                {card.cplc && (
                  <>
                    <div>
                      <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Chip</div>
                      <code>fab={card.cplc.icFabricator} type={card.cplc.icType}</code>
                    </div>
                    <div>
                      <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Serial</div>
                      <code>{card.cplc.icSerialNumber}</code>
                    </div>
                  </>
                )}
              </div>
              <h4 style={{ marginTop: "1rem" }}>Applets / Packages</h4>
              {card.applets.length === 0 ? (
                <div className="empty">Card empty.</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Kind</th>
                      <th>AID</th>
                      <th>State</th>
                      <th>Parent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.applets.map((a) => (
                      <tr key={a.kind + a.aid}>
                        <td>{a.kind}</td>
                        <td><code>{a.aid}</code></td>
                        <td>{a.state}</td>
                        <td><code>{a.parent ?? "—"}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
