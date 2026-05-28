// Curvault card sticker generator.
//
// Ports the standalone HTML/JS canvas renderer into a React view so the
// brand asset for any issued card can be produced from the same workstation
// that personalises it. UI is in English to match the rest of the app; the
// rendered sticker itself is unchanged (logo + capability chips + QR + SN).

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";

const LOGO_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 120 120">` +
  `<defs><linearGradient id="iB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#36c5ff"/><stop offset="1" stop-color="#1b4fd6"/></linearGradient></defs>` +
  `<path d="M 86.87 33.13 A 38 38 0 1 0 86.87 86.87" fill="none" stroke="url(#iB)" stroke-width="9" stroke-linecap="round"/>` +
  `<path d="M 76.97 43.03 A 24 24 0 1 0 76.97 76.97" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" opacity=".9"/>` +
  `<circle cx="60" cy="60" r="6.5" fill="#fff"/></svg>`;

const NFC_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 40 40" fill="none" stroke="#dbe6fb" stroke-width="3.6" stroke-linecap="round">` +
  `<path d="M14 12 A 14 14 0 0 1 14 28"/><path d="M20 9 A 20 20 0 0 1 20 31"/><path d="M26 6 A 26 26 0 0 1 26 34"/></svg>`;

const waveSvg = (s: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 100 100" preserveAspectRatio="none">` +
  `<defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="0.3">` +
  `<stop offset="0" stop-color="#36c5ff" stop-opacity="0"/>` +
  `<stop offset=".5" stop-color="#3f8bff" stop-opacity=".9"/>` +
  `<stop offset="1" stop-color="#1b4fd6" stop-opacity="0"/>` +
  `</linearGradient></defs>` +
  `<g fill="none" stroke="url(#lg)" stroke-linecap="round" transform="rotate(-14 50 60)">` +
  `<path d="M-20 40 C 20 20, 60 64, 130 30" stroke-width=".55" opacity=".9"/>` +
  `<path d="M-20 48 C 20 28, 60 72, 130 38" stroke-width=".5" opacity=".75"/>` +
  `<path d="M-20 56 C 20 36, 60 80, 130 46" stroke-width=".5" opacity=".6"/>` +
  `<path d="M-20 64 C 20 44, 60 88, 130 54" stroke-width=".45" opacity=".48"/>` +
  `<path d="M-20 72 C 20 52, 60 96, 130 62" stroke-width=".45" opacity=".36"/>` +
  `<path d="M-20 80 C 20 60, 60 104, 130 70" stroke-width=".4" opacity=".26"/>` +
  `<path d="M-20 88 C 20 68, 60 112, 130 78" stroke-width=".4" opacity=".18"/>` +
  `</g></svg>`;

const CAP_ICON: Record<string, string> = {
  PKI:
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#a9c8ff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">` +
    `<rect x="3.5" y="4" width="17" height="11" rx="1.5"/><path d="M6.5 7.5h7M6.5 10h5"/><circle cx="16" cy="16.5" r="3"/>` +
    `<path d="M14.4 18.8L13.5 22l2.5-1.4L18.5 22l-.9-3.2"/></svg>`,
  FIDO2:
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#a9c8ff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M5 12a7 7 0 0 1 14 0v2"/><path d="M8 12a4 4 0 0 1 8 0v3.5"/><path d="M11 12a1 1 0 0 1 2 0v4.5"/>` +
    `<path d="M5.5 16v1.5M19 16.5c0 1.5-.3 2.7-.7 3.5"/></svg>`,
  ECC:
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#a9c8ff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M5 19c0-9 3.5-14 7-14s0 9 3 9 2.5-3 3.5-5"/>` +
    `<circle cx="8" cy="12.5" r="1.4" fill="#a9c8ff" stroke="none"/>` +
    `<circle cx="15" cy="10" r="1.4" fill="#a9c8ff" stroke="none"/></svg>`,
  RSA:
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#a9c8ff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">` +
    `<circle cx="8" cy="8" r="3.5"/><path d="M10.5 10.5l7 7"/><path d="M15 15l-1.6 1.6"/><path d="M17.5 17.5l-1.6 1.6"/></svg>`,
};

const CAPS = ["PKI", "FIDO2", "ECC", "RSA"] as const;

function svgImg(svg: string): Promise<HTMLImageElement> {
  // Use a data: URL rather than a blob: URL — Tauri's default CSP allows
  // `img-src 'self' data:` but not `blob:`, so blob URLs silently fail
  // to load and the capability chip icons go missing.
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = (e) => reject(e);
    // btoa needs ASCII; SVG attribute names + paths are ASCII-safe, but
    // we round-trip through encodeURIComponent / unescape just in case
    // any text content contains non-Latin characters in the future.
    const encoded = btoa(unescape(encodeURIComponent(svg)));
    im.src = `data:image/svg+xml;base64,${encoded}`;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function measureSpaced(ctx: CanvasRenderingContext2D, text: string, sp: number): number {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + sp;
  return w - sp;
}

function drawSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, sp: number) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + sp;
  }
}

interface RenderOpts {
  sn: string;
  transparent: boolean;
  qrCanvas: HTMLCanvasElement | null;
}

async function render(
  ctx: CanvasRenderingContext2D,
  S: number,
  opts: RenderOpts,
  layerCache: Map<string, HTMLImageElement>,
): Promise<void> {
  const getLayer = async (key: string, svg: string): Promise<HTMLImageElement> => {
    const k = `${key}-${S}`;
    const cached = layerCache.get(k);
    if (cached) return cached;
    const img = await svgImg(svg);
    layerCache.set(k, img);
    return img;
  };

  const u = (v: number) => (v / 100) * S;
  const radius = S * 0.07;

  ctx.clearRect(0, 0, S, S);
  ctx.save();
  roundRect(ctx, 0, 0, S, S, radius);
  ctx.clip();

  if (!opts.transparent) {
    const g = ctx.createRadialGradient(S * 0.8, S * 0.08, 0, S * 0.8, S * 0.08, S * 1.05);
    g.addColorStop(0, "#16264f");
    g.addColorStop(0.48, "#0b1430");
    g.addColorStop(1, "#060b1a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }

  // Dotted texture.
  const cols = 26, rows = 26;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) / cols * 100;
      const y = (r + 0.5) / rows * 100;
      const wave = Math.sin(x * 0.12 + y * 0.16 - 1.2);
      const band = Math.cos((x - y) * 0.07);
      const a = Math.max(0, Math.min(1, (wave * 0.5 + 0.5) * (band * 0.4 + 0.6))) * 0.5;
      if (a < 0.04) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = a > 0.32 ? "#46c8ff" : "#3a6fd8";
      ctx.beginPath();
      ctx.arc(u(x), u(y), u(0.25 + a * 0.5), 0, 7);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  try { ctx.drawImage(await getLayer("w", waveSvg(S)), 0, 0, S, S); } catch { /* ignore */ }

  // Header: logo + wordmark + NFC waves.
  const topMid = u(7.5) + u(24) / 2;
  const logoPx = S * 0.168;
  try { ctx.drawImage(await getLayer("l", LOGO_SVG), u(7.5), topMid - logoPx / 2, logoPx, logoPx); } catch { /* ignore */ }

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const wmSize = S * 0.108;
  const wmX = u(7.5) + logoPx + S * 0.028;
  ctx.fillStyle = "#fff";
  ctx.font = `700 ${wmSize}px 'Segoe UI','PingFang SC',sans-serif`;
  const w1 = "Cur";
  const w1w = ctx.measureText(w1).width;
  ctx.fillText(w1, wmX, topMid);
  ctx.font = `800 ${wmSize}px 'Segoe UI','PingFang SC',sans-serif`;
  ctx.fillText("vault", wmX + w1w, topMid);

  const nfcPx = S * 0.088;
  try { ctx.drawImage(await getLayer("n", NFC_SVG), S - u(7.5) - nfcPx, topMid - nfcPx / 2, nfcPx, nfcPx); } catch { /* ignore */ }

  // Bottom-right: QR frame + SN sublabel.
  const margin = u(7.5);
  const frameSize = S * 0.235;
  const frameX = S - margin - frameSize;
  const subFont = S * 0.038;
  const ssp = subFont * 0.05;
  const subGap = S * 0.028;
  const subY = S - margin - subFont;
  const frameY = subY - subGap - frameSize;

  ctx.lineWidth = Math.max(1.5, S * 0.0034);
  ctx.strokeStyle = "rgba(255,255,255,.85)";
  roundRect(ctx, frameX, frameY, frameSize, frameSize, frameSize * 0.13);
  ctx.stroke();

  if (opts.qrCanvas && opts.qrCanvas.width > 0) {
    const ip = frameSize * 0.07;
    const ix = frameX + ip;
    const iy = frameY + ip;
    const is = frameSize - ip * 2;
    ctx.fillStyle = "#fff";
    roundRect(ctx, ix, iy, is, is, is * 0.06);
    ctx.fill();
    const qz = is * 0.07;
    const q = is - qz * 2;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(opts.qrCanvas, ix + qz, iy + qz, q, q);
    ctx.imageSmoothingEnabled = true;
  }

  // SN sublabel centered under the QR frame.
  ctx.fillStyle = "#aebfe0";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const subTxt = opts.sn.trim() || " ";
  ctx.font = `600 ${subFont}px 'SFMono-Regular','Consolas','Roboto Mono','Courier New',monospace`;
  const subW = measureSpaced(ctx, subTxt, ssp);
  drawSpaced(ctx, subTxt, frameX + (frameSize - subW) / 2, subY, ssp);

  // Bottom-left: capability chips.
  const capH = S * 0.072;
  const capIcon = S * 0.05;
  const capFont = S * 0.036;
  const capY = frameY + frameSize - capH;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  const maxColW = (col: number): number => {
    ctx.font = `700 ${capFont}px 'Segoe UI','PingFang SC',sans-serif`;
    let m = 0;
    for (let i = col; i < CAPS.length; i += 2) {
      const tw = ctx.measureText(CAPS[i]).width;
      const w = S * 0.024 + capIcon + S * 0.014 + tw + S * 0.024;
      if (w > m) m = w;
    }
    return m;
  };

  const rowGap = S * 0.02;
  for (let i = 0; i < CAPS.length; i++) {
    const cap = CAPS[i];
    ctx.font = `700 ${capFont}px 'Segoe UI','PingFang SC',sans-serif`;
    const tw = ctx.measureText(cap).width;
    const padX = S * 0.024;
    const gap = S * 0.014;
    const chipW = padX + capIcon + gap + tw + padX;
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cx = col === 0 ? margin : margin + maxColW(0) + S * 0.018;
    const cy = capY - (1 - row) * (capH + rowGap);

    ctx.fillStyle = "rgba(70,120,210,.16)";
    ctx.strokeStyle = "rgba(130,170,255,.38)";
    ctx.lineWidth = Math.max(1, S * 0.0016);
    roundRect(ctx, cx, cy, chipW, capH, capH * 0.32);
    ctx.fill();
    ctx.stroke();
    try { ctx.drawImage(await getLayer(`c${cap}`, CAP_ICON[cap]), cx + padX, cy + (capH - capIcon) / 2, capIcon, capIcon); } catch { /* ignore */ }
    ctx.fillStyle = "#cfdcff";
    ctx.font = `700 ${capFont}px 'Segoe UI','PingFang SC',sans-serif`;
    ctx.fillText(cap, cx + padX + capIcon + gap, cy + capH / 2);
  }

  ctx.restore();
}

const PREVIEW_S = 900;

export default function StickerView() {
  const [sn, setSn] = useState("CVT0000000");
  const [size, setSize] = useState(1000);
  const [transparent, setTransparent] = useState(false);

  const previewRef = useRef<HTMLCanvasElement>(null);
  const qrRef = useRef<HTMLCanvasElement | null>(null);
  const layerCache = useMemo(() => new Map<string, HTMLImageElement>(), []);

  // Keep a hidden QR canvas current with the latest SN.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cv = qrRef.current ?? document.createElement("canvas");
      qrRef.current = cv;
      await QRCode.toCanvas(cv, sn || " ", {
        width: 260,
        errorCorrectionLevel: "M",
        color: { dark: "#0a1228", light: "#ffffff" },
      });
      if (cancelled) return;
      // Trigger a preview re-render now that the QR canvas has fresh content.
      if (previewRef.current) {
        await render(previewRef.current.getContext("2d")!, PREVIEW_S, {
          sn,
          transparent,
          qrCanvas: qrRef.current,
        }, layerCache);
      }
    })();
    return () => { cancelled = true; };
  }, [sn, transparent, layerCache]);

  const onExport = async () => {
    const S = Math.max(200, Math.min(6000, size || 1000));
    if (document.fonts?.ready) await document.fonts.ready;
    const cv = document.createElement("canvas");
    cv.width = S;
    cv.height = S;
    await render(cv.getContext("2d")!, S, {
      sn,
      transparent,
      qrCanvas: qrRef.current,
    }, layerCache);
    cv.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `curvault-${(sn || "sticker").trim()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  };

  const onExportQr = async () => {
    const src = qrRef.current;
    if (!src) return;
    const S = Math.max(200, Math.min(6000, size || 1000));
    const cv = document.createElement("canvas");
    cv.width = S;
    cv.height = S;
    const ctx = cv.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, S, S);
    const qz = S * 0.08;
    ctx.drawImage(src, qz, qz, S - qz * 2, S - qz * 2);
    cv.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `qr-${(sn || "code").trim()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
  };

  return (
    <>
      <h2>Card Sticker</h2>

      <div className="row" style={{ alignItems: "flex-start", gap: "1.5rem" }}>
        <div className="card" style={{ flex: "0 0 320px", marginBottom: 0 }}>
          <h3>Settings</h3>

          <div className="field">
            <label>Serial / ID</label>
            <input value={sn} onChange={(e) => setSn(e.target.value)} maxLength={20} />
            <small style={{ color: "var(--text-dim)", fontSize: 11 }}>
              Shown in the SN slot and encoded into the QR code.
            </small>
          </div>

          <div className="field">
            <label>Output size (square, px)</label>
            <input
              type="number"
              min={200}
              max={6000}
              step={50}
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
            <small style={{ color: "var(--text-dim)", fontSize: 11 }}>
              Common: ≥1000 for print, 600 for web.
            </small>
          </div>

          <div className="field">
            <label>Background</label>
            <div className="row" style={{ gap: 0, border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
              <button
                style={{
                  flex: 1,
                  borderRadius: 0,
                  background: !transparent ? "var(--accent)" : "var(--bg-input)",
                  color: !transparent ? "white" : "var(--text-dim)",
                  border: "none",
                }}
                onClick={() => setTransparent(false)}
              >
                Dark blue
              </button>
              <button
                style={{
                  flex: 1,
                  borderRadius: 0,
                  background: transparent ? "var(--accent)" : "var(--bg-input)",
                  color: transparent ? "white" : "var(--text-dim)",
                  border: "none",
                }}
                onClick={() => setTransparent(true)}
              >
                Transparent
              </button>
            </div>
          </div>

          <button className="primary" style={{ width: "100%" }} onClick={onExport}>
            Export PNG
          </button>
          <button style={{ width: "100%", marginTop: ".5rem" }} onClick={onExportQr}>
            Export QR only
          </button>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
          <canvas
            ref={previewRef}
            width={PREVIEW_S}
            height={PREVIEW_S}
            style={{
              width: "100%",
              maxWidth: 460,
              height: "auto",
              borderRadius: "7%",
              boxShadow: "0 18px 50px rgba(10,18,40,.32)",
            }}
          />
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
            Preview matches export pixel-for-pixel.
          </div>
        </div>
      </div>
    </>
  );
}
