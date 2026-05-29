import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listReaders, listGpKeys, installApplet, uninstallApplet } from "../lib/api";
import type { Reader, GpKeyHandle, CommandResult } from "../types";
import LoadingOverlay from "../components/LoadingOverlay";

const ISOAPPLET_PKG = "F276A288BCFBA69D34F310";
const ISOAPPLET_APP = "F276A288BCFBA69D34F31001";

export default function AppletInstallerView() {
  const [readers, setReaders] = useState<Reader[]>([]);
  const [keys, setKeys] = useState<GpKeyHandle[]>([]);
  const [reader, setReader] = useState<string>("");
  const [gpKeyId, setGpKeyId] = useState<string>(""); // "" = use default
  const [capPath, setCapPath] = useState<string>("");
  const [pkgAid, setPkgAid] = useState(ISOAPPLET_PKG);
  const [appletAid, setAppletAid] = useState(ISOAPPLET_APP);
  const [instanceAid, setInstanceAid] = useState("");
  const [busy, setBusy] = useState(true);
  const [result, setResult] = useState<CommandResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setBusy(true);
    Promise.all([listReaders(), listGpKeys()])
      .then(([r, k]) => {
        setReaders(r);
        setKeys(k);
        if (!reader && r.length) setReader(r[0].name);
      })
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickCap = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "CAP", extensions: ["cap"] }],
    });
    if (typeof selected === "string") setCapPath(selected);
  };

  const onInstall = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await installApplet(reader, gpKeyId || null, {
        capPath,
        packageAid: pkgAid,
        appletAid,
        instanceAid: instanceAid || undefined,
      });
      setResult(r);
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onUninstall = async () => {
    if (!confirm(`Uninstall package ${pkgAid} from card on ${reader}? This removes ALL applets in that package and all their data.`)) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await uninstallApplet(reader, gpKeyId || null, pkgAid);
      setResult(r);
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <LoadingOverlay show={busy} label="Running gp…" />
      <h2>Applet Installer</h2>

      <div className="card">
        <div className="field">
          <label>Reader</label>
          <select value={reader} onChange={(e) => setReader(e.target.value)}>
            <option value="">— pick reader —</option>
            {readers.map((r) => (
              <option key={r.name} value={r.name} disabled={!r.hasCard}>
                {r.name} {r.hasCard ? "(card)" : "(empty)"}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>GP key</label>
          <select value={gpKeyId} onChange={(e) => setGpKeyId(e.target.value)}>
            <option value="">Default test key (40 41 42 … 4F)</option>
            {keys.map((k) => {
              // Build a readable label that surfaces the user-supplied note,
              // the card serial it was generated against, and the vault id.
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
          {gpKeyId && keys.find((k) => k.id === gpKeyId)?.note && (
            <small style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 2 }}>
              Note: {keys.find((k) => k.id === gpKeyId)?.note}
            </small>
          )}
        </div>

        <div className="field">
          <label>CAP file</label>
          <div className="row">
            <input value={capPath} onChange={(e) => setCapPath(e.target.value)} style={{ flex: 1 }} />
            <button onClick={pickCap}>Browse…</button>
          </div>
        </div>

        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Package AID</label>
            <input value={pkgAid} onChange={(e) => setPkgAid(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Applet AID</label>
            <input value={appletAid} onChange={(e) => setAppletAid(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Instance AID (optional)</label>
            <input
              value={instanceAid}
              onChange={(e) => setInstanceAid(e.target.value)}
              placeholder="defaults to applet AID"
            />
          </div>
        </div>

        <div className="row">
          <button className="primary" disabled={busy || !reader || !capPath} onClick={onInstall}>
            Install
          </button>
          <button className="danger" disabled={busy || !reader} onClick={onUninstall}>
            Uninstall package
          </button>
        </div>
      </div>

      {err && <div className="card" style={{ borderColor: "var(--error)" }}><pre>{err}</pre></div>}
      {result && (
        <div className="card">
          <h3>Result (exit {result.exitCode})</h3>
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
