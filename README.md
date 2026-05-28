# Curvault

Desktop card-issuance workstation for **IsoApplet / JavaCard** and
**FIDO2 authenticators**.

Built with **Tauri 2 + React 18 + TypeScript**. Everything — GP key
handling, applet installation, PKCS#15 init, profile management, FIDO2
credential management, full issuance flow — happens inside the app.
Secrets never leave the OS keychain.

<p align="center">
  <img src="src-tauri/icons/icon.svg" width="120" height="120" alt="Curvault" />
</p>

## Features

| View | What it does |
|---|---|
| Dashboard | Reader / card / key / profile overview |
| Readers | List PC/SC readers, read ATR, dump CPLC + applet list |
| GP Keys | Generate random GP keys, store in OS keychain, lock cards |
| Applet Installer | Install / uninstall CAP files via embedded `gp` |
| PKCS#15 Init | Lay down EF.TokenInfo with custom label / manufacturer / serial, set PIN+PUK |
| Profiles | CRUD profiles (PKCS#15 spec, key plan, CA config) |
| FIDO2 | List devices / credentials, set PIN, delete creds, factory reset |
| Issuance | End-to-end flow with timeline + per-step audit |
| Card Sticker | Generate Curvault-branded PNG stickers with QR-encoded serial |

## Prerequisites

| Tool | Purpose | Install (macOS) |
|---|---|---|
| Node 20+ | Frontend deps + Vite dev server | `brew install node` |
| Rust stable (1.75+) | Tauri backend | `brew install rust` |
| `gp` (GlobalPlatformPro) | Applet install / GP key ops | `brew install gp` |
| `opensc-tool`, `pkcs15-init`, `pkcs15-tool`, `pkcs11-tool` | PKCS#15 + reader ops | `brew install opensc` |
| `openssl` | CSR signing via PKCS#11 engine | `brew install openssl` |
| `fido2-token` (libfido2) | FIDO2 management | `brew install libfido2` |

## Development

```bash
# 1. clone + install
gh repo clone wa-otomia/curvault
cd curvault
pnpm install            # or npm install

# 2. dev mode (Vite + Cargo hot reload, single window)
pnpm tauri dev
```

## Production build

```bash
pnpm tauri build
# macOS:    src-tauri/target/release/bundle/dmg/Curvault_0.1.0_*.dmg
# Windows:  src-tauri/target/release/bundle/nsis/Curvault_0.1.0_*-setup.exe
# Linux:    src-tauri/target/release/bundle/appimage/Curvault_0.1.0_amd64.AppImage
```

CI builds all three on tag push — see `.github/workflows/release.yml`.

## Architecture

```
┌────────────────────────────────────────────┐
│  React UI (TSX)                            │
│   - components/                            │
│   - views/Dashboard, Readers, GpKeys,      │
│     AppletInstaller, Pkcs15, Profiles,     │
│     Fido2, Issuance                        │
│   - lib/api.ts ── single invoke() entry    │
└──────────────────┬─────────────────────────┘
                   │ Tauri IPC
┌──────────────────┴─────────────────────────┐
│  Rust backend (src-tauri/src/services/)    │
│                                            │
│   gp ─── shells `gp` for SCP02 ops         │
│   opensc ─── readers / ATR                 │
│   pcsc ─── high-level snapshots            │
│   pkcs15 ─── pkcs15-init wrapper           │
│   fido2 ─── fido2-token wrapper            │
│   vault ─── OS keychain (keyring crate)    │
│   profile ─── JSON in user config dir      │
│   issuance ─── orchestration               │
└────────────────────────────────────────────┘
```

- **Frontend never spawns processes.** Every command goes through
  `src/lib/api.ts` → `invoke()` → Rust.
- **Secrets live in the OS keychain.** GP keys, PINs, PUKs — none
  reach the renderer; UI only sees handle IDs.
- **Shell allowlist** in `src-tauri/capabilities/default.json` limits
  executables to `gp / opensc-tool / pkcs15-* / pkcs11-tool / openssl /
  fido2-token`.

## Brand assets

The C-curve mark in `src-tauri/icons/icon.svg` is the source of truth.
PNG / ICO / ICNS variants are produced by `scripts/render-icons.py`
(stdlib-only Python rasteriser, no Pillow / Inkscape required).

```bash
pnpm icons   # regenerate src-tauri/icons/{32x32,128x128,128x128@2x,icon}.{png,ico,icns}
```

## License

MIT — see [LICENSE](LICENSE).
