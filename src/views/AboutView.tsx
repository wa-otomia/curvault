import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { check as checkUpdate, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const REPO_URL = "https://github.com/wa-otomia/curvault";

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date"; current: string }
  | { kind: "available"; update: Update }
  | { kind: "downloading"; received: number; total: number | null }
  | { kind: "installing" }
  | { kind: "error"; message: string };

export default function AboutView() {
  const [version, setVersion] = useState<string>("");
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  const onOpenRepo = async () => {
    try { await openExternal(REPO_URL); }
    catch { navigator.clipboard.writeText(REPO_URL).catch(() => {}); }
  };

  const onCheckUpdate = async () => {
    setCheck({ kind: "checking" });
    try {
      const update = await checkUpdate();
      if (!update?.available) {
        setCheck({ kind: "up-to-date", current: version || "?" });
      } else {
        setCheck({ kind: "available", update });
      }
    } catch (e: unknown) {
      setCheck({ kind: "error", message: String(e) });
    }
  };

  const onInstall = async () => {
    if (check.kind !== "available") return;
    const update = check.update;
    setCheck({ kind: "downloading", received: 0, total: null });
    try {
      let received = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data?.contentLength ?? null;
            setCheck({ kind: "downloading", received: 0, total });
            break;
          case "Progress":
            received += event.data.chunkLength;
            setCheck({ kind: "downloading", received, total });
            break;
          case "Finished":
            setCheck({ kind: "installing" });
            break;
        }
      });
      // downloadAndInstall returns once the update is staged; restart.
      await relaunch();
    } catch (e: unknown) {
      setCheck({ kind: "error", message: String(e) });
    }
  };

  const fmtBytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  };

  return (
    <>
      <h2>About</h2>
      <div
        className="card"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "2.5rem 2rem",
          textAlign: "center",
          gap: "0.75rem",
        }}
      >
        <svg width="96" height="96" viewBox="0 0 120 120" style={{ marginBottom: "0.5rem" }}>
          <defs>
            <linearGradient id="aboutBg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#36c5ff" />
              <stop offset="1" stopColor="#1b4fd6" />
            </linearGradient>
          </defs>
          <path d="M 86.87 33.13 A 38 38 0 1 0 86.87 86.87"
                fill="none" stroke="url(#aboutBg)" strokeWidth="9" strokeLinecap="round" />
          <path d="M 76.97 43.03 A 24 24 0 1 0 76.97 76.97"
                fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity=".9" />
          <circle cx="60" cy="60" r="6.5" fill="#fff" />
        </svg>

        <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, letterSpacing: 1 }}>Curvault</h1>
        <div style={{ color: "var(--text-dim)", fontSize: 14 }}>
          Desktop card-issuance workstation for IsoApplet / JavaCard / FIDO2.
        </div>

        <div style={{ display: "flex", gap: "1.5rem", marginTop: "0.75rem", color: "var(--text-dim)", fontSize: 13 }}>
          <span><strong style={{ color: "var(--text)" }}>Version</strong> · {version || "—"}</span>
          <span><strong style={{ color: "var(--text)" }}>Author</strong> · Onmiya</span>
          <span><strong style={{ color: "var(--text)" }}>License</strong> · MIT</span>
        </div>

        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem", flexWrap: "wrap", justifyContent: "center" }}>
          <button
            onClick={onOpenRepo}
            title={REPO_URL}
            style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.55rem 1.1rem" }}
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            <span>wa-otomia/curvault</span>
          </button>

          <button
            className="primary"
            onClick={onCheckUpdate}
            disabled={check.kind === "checking" || check.kind === "downloading" || check.kind === "installing"}
            style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.55rem 1.1rem" }}
          >
            {check.kind === "checking" ? "Checking…" : "Check for updates"}
          </button>
        </div>

        {check.kind === "error" && (
          <UpdateBox color="error">
            <div style={{ fontWeight: 600 }}>Update check failed</div>
            <div style={{ fontSize: 12, marginTop: 4, opacity: 0.85 }}>{check.message}</div>
          </UpdateBox>
        )}

        {check.kind === "up-to-date" && (
          <UpdateBox color="ok">
            <div style={{ fontWeight: 600 }}>You're on the latest version.</div>
            <div style={{ fontSize: 12, marginTop: 4, color: "var(--text-dim)" }}>
              v{check.current} matches the newest signed release.
            </div>
          </UpdateBox>
        )}

        {check.kind === "available" && (
          <UpdateBox color="accent">
            <div style={{ fontWeight: 600 }}>
              Update available · v{check.update.version}
            </div>
            <div style={{ fontSize: 12, marginTop: 4, color: "var(--text-dim)" }}>
              You're on v{check.update.currentVersion}.
              {check.update.date && ` Released ${new Date(check.update.date).toLocaleDateString()}.`}
            </div>
            {check.update.body && (
              <pre style={{ maxHeight: 180, marginTop: 8, fontSize: 11, whiteSpace: "pre-wrap", background: "rgba(0,0,0,0.25)" }}>
                {check.update.body.slice(0, 800)}
                {check.update.body.length > 800 ? "\n…" : ""}
              </pre>
            )}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: 10, justifyContent: "center" }}>
              <button className="primary" onClick={onInstall}>
                Download &amp; install
              </button>
              <button
                onClick={() => openExternal(`${REPO_URL}/releases/tag/v${check.update.version}`).catch(() => {})}
              >
                Open release page
              </button>
            </div>
          </UpdateBox>
        )}

        {check.kind === "downloading" && (
          <UpdateBox color="accent">
            <div style={{ fontWeight: 600 }}>Downloading update…</div>
            <div style={{ fontSize: 12, marginTop: 6, color: "var(--text-dim)" }}>
              {fmtBytes(check.received)}
              {check.total ? ` / ${fmtBytes(check.total)}` : ""}
            </div>
            {check.total && (
              <div style={{ marginTop: 8, height: 4, background: "var(--bg-elev-2)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  width: `${Math.min(100, (check.received / check.total) * 100)}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, var(--accent), var(--accent-2))",
                  transition: "width 0.2s",
                }} />
              </div>
            )}
          </UpdateBox>
        )}

        {check.kind === "installing" && (
          <UpdateBox color="accent">
            <div style={{ fontWeight: 600 }}>Installing — the app will restart momentarily…</div>
          </UpdateBox>
        )}

        <div style={{ marginTop: "1.5rem", color: "var(--text-mute)", fontSize: 11, letterSpacing: 0.3 }}>
          Built with Tauri 2 · React 18 · TypeScript · Rust
        </div>
      </div>
    </>
  );
}

function UpdateBox({
  color,
  children,
}: {
  color: "ok" | "accent" | "error";
  children: React.ReactNode;
}) {
  const borderColor =
    color === "ok" ? "var(--ok)" :
    color === "error" ? "var(--error)" :
    "var(--accent)";
  const bg =
    color === "ok" ? "rgba(76,175,122,0.06)" :
    color === "error" ? "rgba(227,95,95,0.06)" :
    "rgba(54,197,255,0.06)";
  return (
    <div
      style={{
        marginTop: "1rem",
        padding: "0.8rem 1.1rem",
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        maxWidth: 560,
        textAlign: "left",
        background: bg,
      }}
    >
      {children}
    </div>
  );
}
