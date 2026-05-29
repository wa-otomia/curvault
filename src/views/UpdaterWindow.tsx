import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { check as checkUpdate, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import BrandBackdrop from "../components/BrandBackdrop";
import BrandLogo from "../components/BrandLogo";

const REPO_URL = "https://github.com/wa-otomia/curvault";

type State =
  | { kind: "checking" }
  | { kind: "up-to-date"; current: string }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; update: Update; received: number; total: number | null }
  | { kind: "ready"; version: string } // downloaded & staged — waiting for manual restart
  | { kind: "error"; message: string };

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function UpdaterWindow() {
  const [state, setState] = useState<State>({ kind: "checking" });
  const [version, setVersion] = useState("");

  const runCheck = async () => {
    setState({ kind: "checking" });
    try {
      const v = await getVersion().catch(() => "");
      setVersion(v);
      const update = await checkUpdate();
      if (!update?.available) setState({ kind: "up-to-date", current: v || "?" });
      else setState({ kind: "available", update });
    } catch (e: unknown) {
      setState({ kind: "error", message: String(e) });
    }
  };

  useEffect(() => {
    runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDownload = async () => {
    if (state.kind !== "available") return;
    const update = state.update;
    setState({ kind: "downloading", update, received: 0, total: null });
    try {
      let received = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data?.contentLength ?? null;
            setState({ kind: "downloading", update, received: 0, total });
            break;
          case "Progress":
            received += event.data.chunkLength;
            setState({ kind: "downloading", update, received, total });
            break;
          case "Finished":
            break;
        }
      });
      // Staged but NOT relaunched — the user restarts manually.
      setState({ kind: "ready", version: update.version });
    } catch (e: unknown) {
      setState({ kind: "error", message: String(e) });
    }
  };

  const onRestart = async () => {
    try { await relaunch(); }
    catch (e: unknown) { setState({ kind: "error", message: String(e) }); }
  };

  const onClose = () => { getCurrentWindow().close().catch(() => {}); };

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.85rem",
        padding: "2rem 1.75rem",
        textAlign: "center",
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      <BrandBackdrop opacity={0.55} />

      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.85rem" }}>
        <BrandLogo size={96} />
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: 0.5 }}>Software Update</h1>

        {state.kind === "checking" && (
          <p style={{ color: "var(--text-dim)", margin: 0 }}>Checking for updates…</p>
        )}

        {state.kind === "up-to-date" && (
          <>
            <p style={{ margin: 0, fontWeight: 600 }}>You're up to date.</p>
            <p style={{ color: "var(--text-dim)", fontSize: 13, margin: 0 }}>
              v{state.current} is the newest signed release.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <button onClick={runCheck}>Check again</button>
              <button className="primary" onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {state.kind === "available" && (
          <>
            <p style={{ margin: 0, fontWeight: 600 }}>Update available · v{state.update.version}</p>
            <p style={{ color: "var(--text-dim)", fontSize: 13, margin: 0 }}>
              You're on v{state.update.currentVersion}.
              {state.update.date && ` Released ${new Date(state.update.date).toLocaleDateString()}.`}
            </p>
            {state.update.body && (
              <pre style={{
                maxHeight: 200, width: "100%", marginTop: 4, fontSize: 11,
                whiteSpace: "pre-wrap", textAlign: "left",
                background: "rgba(0,0,0,0.28)", borderRadius: 6, padding: "0.6rem 0.7rem",
              }}>
                {state.update.body.slice(0, 1200)}
                {state.update.body.length > 1200 ? "\n…" : ""}
              </pre>
            )}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap", justifyContent: "center" }}>
              <button className="primary" onClick={onDownload}>Download &amp; install</button>
              <button onClick={() => openExternal(`${REPO_URL}/releases/tag/v${state.update.version}`).catch(() => {})}>
                Release notes
              </button>
              <button onClick={onClose}>Later</button>
            </div>
          </>
        )}

        {state.kind === "downloading" && (
          <>
            <p style={{ margin: 0, fontWeight: 600 }}>Downloading v{state.update.version}…</p>
            <p style={{ color: "var(--text-dim)", fontSize: 13, margin: 0 }}>
              {fmtBytes(state.received)}{state.total ? ` / ${fmtBytes(state.total)}` : ""}
            </p>
            <div style={{ width: "100%", height: 5, background: "var(--bg-elev-2, rgba(255,255,255,0.08))", borderRadius: 3, overflow: "hidden", marginTop: 4 }}>
              <div style={{
                width: state.total ? `${Math.min(100, (state.received / state.total) * 100)}%` : "40%",
                height: "100%",
                background: "linear-gradient(90deg, #36c5ff, #1b4fd6)",
                transition: "width 0.2s",
              }} />
            </div>
          </>
        )}

        {state.kind === "ready" && (
          <>
            <p style={{ margin: 0, fontWeight: 600, color: "var(--ok)" }}>
              v{state.version} downloaded.
            </p>
            <p style={{ color: "var(--text-dim)", fontSize: 13, margin: 0 }}>
              Restart Curvault to finish updating. You can keep working and restart later.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <button className="primary" onClick={onRestart}>Restart now</button>
              <button onClick={onClose}>Later</button>
            </div>
          </>
        )}

        {state.kind === "error" && (
          <>
            <p style={{ margin: 0, fontWeight: 600, color: "var(--error)" }}>Update failed</p>
            <pre style={{
              maxHeight: 180, width: "100%", fontSize: 11, whiteSpace: "pre-wrap",
              textAlign: "left", background: "rgba(0,0,0,0.28)", borderRadius: 6, padding: "0.6rem 0.7rem",
            }}>
              {state.message}
            </pre>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <button onClick={runCheck}>Retry</button>
              <button className="primary" onClick={onClose}>Close</button>
            </div>
          </>
        )}

        {version && (
          <div style={{ marginTop: "1rem", color: "var(--text-mute)", fontSize: 11 }}>
            Curvault · v{version}
          </div>
        )}
      </div>
    </div>
  );
}
