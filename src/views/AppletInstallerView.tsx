import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listReaders, listGpKeys, installApplet, uninstallApplet } from "../lib/api";
import type { Reader, GpKeyHandle, CommandResult } from "../types";
import LoadingOverlay from "../components/LoadingOverlay";

// Known AID hints — shown next to user-typed AIDs. Add new ones here as
// they come up. Match is by-prefix so children (instance AIDs) inherit
// the package's friendly name.
const KNOWN_AIDS: { prefix: string; name: string }[] = [
  { prefix: "F276A288BCFBA69D34F310", name: "IsoApplet" },
  { prefix: "A0000006472F0001", name: "FIDO U2F" },
  { prefix: "A000000647",       name: "FIDO Alliance" },
  { prefix: "A000000151",       name: "GlobalPlatform ISD" },
  { prefix: "A000000003",       name: "PIV" },
  { prefix: "A0000000620202",   name: "javacardx.crypto" },
  { prefix: "A0000000620204",   name: "javacard.framework" },
  { prefix: "A00000062001",     name: "Visa" },
  { prefix: "A0000000041010",   name: "Mastercard" },
];

function aidHint(aid: string): string | null {
  const up = aid.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  const match = KNOWN_AIDS.find((k) => up.startsWith(k.prefix));
  return match ? match.name : null;
}

export default function AppletInstallerView() {
  const [readers, setReaders] = useState<Reader[]>([]);
  const [keys, setKeys] = useState<GpKeyHandle[]>([]);
  const [reader, setReader] = useState<string>("");
  const [gpKeyId, setGpKeyId] = useState<string>(""); // "" = use default
  const [capPath, setCapPath] = useState<string>("");
  // AIDs are left blank by default. `gp --install` reads the package and
  // applet AIDs straight from the CAP file, so they only need to be
  // typed when overriding (e.g. multiple instance AIDs, or for
  // documentation / record keeping).
  const [pkgAid, setPkgAid] = useState("");
  const [appletAid, setAppletAid] = useState("");
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
    // gp --uninstall accepts either a package AID or a CAP file path.
    // Prefer the AID when typed; otherwise hand gp the CAP file so the
    // user can pick what to remove via Browse instead of copying the AID.
    const target = pkgAid.trim() || capPath.trim();
    if (!target) return;
    const targetLabel = pkgAid.trim() ? `package ${pkgAid.trim()}` : `package from ${capPath}`;
    if (!confirm(`Uninstall ${targetLabel} from card on ${reader}? This removes ALL applets in that package and all their data.`)) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const r = await uninstallApplet(reader, gpKeyId || null, target);
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
            <label>Package AID (uninstall only)</label>
            <input
              value={pkgAid}
              onChange={(e) => setPkgAid(e.target.value)}
              placeholder="read from CAP on install"
            />
            {pkgAid && aidHint(pkgAid) && (
              <small style={{ color: "var(--accent)", fontSize: 11 }}>
                {aidHint(pkgAid)}
              </small>
            )}
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Applet AID (optional)</label>
            <input
              value={appletAid}
              onChange={(e) => setAppletAid(e.target.value)}
              placeholder="read from CAP"
            />
            {appletAid && aidHint(appletAid) && (
              <small style={{ color: "var(--accent)", fontSize: 11 }}>
                {aidHint(appletAid)}
              </small>
            )}
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
          <button
            className="danger"
            disabled={busy || !reader || (!pkgAid.trim() && !capPath.trim())}
            onClick={onUninstall}
            title={
              !pkgAid.trim() && !capPath.trim()
                ? "Enter a Package AID or pick a CAP file"
                : pkgAid.trim()
                ? `gp --uninstall ${pkgAid.trim()}`
                : `gp --uninstall ${capPath}  (reads AID from CAP)`
            }
          >
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
