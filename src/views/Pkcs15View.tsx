import { useEffect, useMemo, useState } from "react";
import { listReaders, pkcs15Create } from "../lib/api";
import type { Reader, Pkcs15InitResult } from "../types";
import LoadingOverlay from "../components/LoadingOverlay";

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function randomPin(len: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => alphabet[b % alphabet.length]).join("");
}

export default function Pkcs15View() {
  const [readers, setReaders] = useState<Reader[]>([]);
  const [reader, setReader] = useState("");

  const [label, setLabel] = useState("Curvault Card");
  const [manufacturer, setManufacturer] = useState("ACME Corp");
  const [serial, setSerial] = useState(() => randomHex(8));
  const [pin, setPin] = useState(() => randomPin(8));
  const [puk, setPuk] = useState(() => randomHex(8));   // 16 hex chars

  const [busy, setBusy] = useState(true);
  const [result, setResult] = useState<Pkcs15InitResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setBusy(true);
    listReaders()
      .then((r) => {
        setReaders(r);
        const first = r.find((x) => x.hasCard);
        if (first) setReader(first.name);
      })
      .finally(() => setBusy(false));
  }, []);

  const valid = useMemo(() => {
    if (!reader || !label || !serial) return false;
    if (pin.length < 4 || pin.length > 16) return false;
    if (puk.length !== 16) return false;
    return true;
  }, [reader, label, serial, pin, puk]);

  const onSubmit = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await pkcs15Create({
        reader,
        label,
        manufacturer,
        serial,
        pin,
        puk,
      });
      setResult(r);
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <LoadingOverlay show={busy} label="Initializing PKCS#15…" />
      <h2>PKCS#15 Initialization</h2>

      <div className="card">
        <p style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 0 }}>
          Lays down the PKCS#15 application on the card. The card must already
          have IsoApplet installed (use <strong>Applet Installer</strong> if
          not). PIN and PUK are stored in the OS keychain after success —
          their values appear here only once.
        </p>

        <div className="field">
          <label>Reader</label>
          <select value={reader} onChange={(e) => setReader(e.target.value)}>
            <option value="">— pick reader with a card —</option>
            {readers.filter((r) => r.hasCard).map((r) => (
              <option key={r.name} value={r.name}>{r.name}</option>
            ))}
          </select>
        </div>

        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Token label</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Manufacturer ID</label>
            <input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label>Serial number (hex)</label>
          <div className="row">
            <input value={serial} onChange={(e) => setSerial(e.target.value)} style={{ flex: 1 }} />
            <button onClick={() => setSerial(randomHex(8))}>Random</button>
          </div>
        </div>

        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>PIN (4–16 chars)</label>
            <div className="row">
              <input value={pin} onChange={(e) => setPin(e.target.value)} style={{ flex: 1 }} />
              <button onClick={() => setPin(randomPin(8))}>Random</button>
            </div>
            <small style={{ color: pin.length < 4 || pin.length > 16 ? "var(--error)" : "var(--text-dim)" }}>
              length: {pin.length}
            </small>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>PUK (must be exactly 16 chars)</label>
            <div className="row">
              <input value={puk} onChange={(e) => setPuk(e.target.value)} style={{ flex: 1 }} />
              <button onClick={() => setPuk(randomHex(8))}>Random</button>
            </div>
            <small style={{ color: puk.length !== 16 ? "var(--error)" : "var(--text-dim)" }}>
              length: {puk.length}
            </small>
          </div>
        </div>

        <button className="primary" disabled={!valid || busy} onClick={onSubmit}>
          {busy ? "Initializing…" : "Initialize PKCS#15"}
        </button>
      </div>

      {err && (
        <div className="card" style={{ borderColor: "var(--error)" }}>
          <h3>Error</h3>
          <pre>{err}</pre>
        </div>
      )}

      {result && (
        <div className="card" style={{ borderColor: "var(--ok)" }}>
          <h3>Result (exit {result.exitCode})</h3>
          <p>
            Credentials stashed in keychain as <code>pkcs15:{result.credentialsVaultId}</code>.
            Save the PIN <strong>now</strong> — it is not shown again.
          </p>
          {result.stdout && (
            <>
              <div style={{ color: "var(--text-dim)", fontSize: 12 }}>stdout</div>
              <pre>{result.stdout}</pre>
            </>
          )}
          {result.stderr && (
            <>
              <div style={{ color: "var(--text-dim)", fontSize: 12 }}>stderr</div>
              <pre>{result.stderr}</pre>
            </>
          )}
        </div>
      )}
    </>
  );
}
