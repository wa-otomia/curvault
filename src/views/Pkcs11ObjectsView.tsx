import { useState } from "react";
import { pkcs11Dump } from "../lib/api";
import LoadingOverlay from "../components/LoadingOverlay";
import { useCardChange } from "../lib/cardWatch";

export default function Pkcs11ObjectsView() {
  const [module, setModule] = useState("");
  const [dump, setDump] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    setErr(null);
    try {
      setDump(await pkcs11Dump(module || undefined));
    } catch (e: unknown) {
      setErr(String(e));
      setDump("");
    } finally {
      setBusy(false);
    }
  };

  // If a listing is already on screen, refresh it when a card comes or goes
  // (don't trigger an unsolicited dump when nothing is shown yet).
  useCardChange(() => {
    if (dump || err) refresh();
  });

  return (
    <>
      <LoadingOverlay show={busy} label="Querying PKCS#11 module…" />
      <h2>PKCS#11 Objects</h2>
      <div className="card">
        <p style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 0 }}>
          Calls <code>pkcs11-tool --list-slots --list-objects</code> against
          the OpenSC PKCS#11 module. By default the module is auto-detected
          from standard install paths; override if you have a custom one.
        </p>
        <div className="field">
          <label>PKCS#11 module path (optional)</label>
          <input
            placeholder="auto-detect — e.g. /opt/homebrew/lib/opensc-pkcs11.so"
            value={module}
            onChange={(e) => setModule(e.target.value)}
          />
        </div>
        <button className="primary" disabled={busy} onClick={refresh}>
          {busy ? "Reading…" : "Dump PKCS#11"}
        </button>
      </div>

      {err && (
        <div className="card" style={{ borderColor: "var(--error)" }}>
          <pre>{err}</pre>
        </div>
      )}

      {dump && (
        <div className="card">
          <h3>Result</h3>
          <pre style={{ maxHeight: 600 }}>{dump}</pre>
        </div>
      )}
    </>
  );
}
