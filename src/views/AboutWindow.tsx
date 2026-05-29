import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { openUpdaterWindow } from "../lib/api";
import BrandBackdrop from "../components/BrandBackdrop";
import BrandLogo from "../components/BrandLogo";

const REPO_URL = "https://github.com/wa-otomia/curvault";

// Whole window draggable (frameless); spread on non-interactive nodes.
const DRAG = { "data-tauri-drag-region": true } as const;
const noDrag = { onMouseDown: (e: React.MouseEvent) => e.stopPropagation() };

export default function AboutWindow() {
  const [version, setVersion] = useState("");
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  const onClose = () => {
    setClosing(true);
    setTimeout(() => getCurrentWindow().close().catch(() => {}), 300);
  };
  const onOpenRepo = () => { openExternal(REPO_URL).catch(() => {}); };
  const onCheckUpdate = () => { openUpdaterWindow().catch(() => {}); };

  return (
    <div className={`updater-root${closing ? " closing" : ""}`} {...DRAG}>
      <BrandBackdrop opacity={0.5} />

      <div className="updater-content" {...DRAG}>
        <div {...DRAG}><BrandLogo size={104} /></div>
        <h1 className="updater-title" {...DRAG}>Curvault</h1>
        <p className="updater-sub" {...DRAG} style={{ maxWidth: 320 }}>
          Desktop card-issuance workstation for IsoApplet / JavaCard / FIDO2.
        </p>

        <div className="about-meta" {...DRAG}>
          <span><b>Version</b> · {version || "—"}</span>
          <span><b>Author</b> · Onmiya</span>
          <span><b>License</b> · MIT</span>
        </div>

        <div className="updater-actions">
          <button {...noDrag} onClick={onOpenRepo} title={REPO_URL}
                  style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            GitHub
          </button>
          <button {...noDrag} onClick={onCheckUpdate}>Check for updates</button>
        </div>

        <div className="updater-actions">
          <button className="primary" {...noDrag} onClick={onClose}>Close</button>
        </div>

        <div className="updater-version" {...DRAG}>
          Built with Tauri 2 · React 18 · TypeScript · Rust
        </div>
      </div>
    </div>
  );
}
