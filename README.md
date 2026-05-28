# Smartcard Issuer

Desktop card-issuance workstation for IsoApplet / JavaCard.

Built with **Tauri 2 + React 18 + TypeScript**. All GP key handling,
applet installation, PKCS#15 initialization and profile management
happen inside the app — no external scripts to babysit.

## Features (in progress)

- [x] Detect connected PC/SC readers and present CPLC info
- [x] Manage GP keys: generate, store in OS keychain, retrieve by card serial
- [x] Install / uninstall applets via embedded `gp`
- [x] CRUD profiles (label, manufacturer, serial scheme, key plan)
- [ ] Run a full issuance flow with progress and audit log
- [ ] PKCS#15 init wizard with custom token info
- [ ] CSR generation via PKCS#11 engine
- [ ] CA integration (step-ca / EJBCA REST)

## Prerequisites

| Tool | Purpose |
|---|---|
| Node 20+, pnpm (or npm) | Frontend deps and dev server |
| Rust stable (1.75+) | Tauri backend |
| `gp` (GlobalPlatformPro) | Installed and on `$PATH` |
| `opensc-tool`, `pkcs15-init`, `pkcs15-tool` (OpenSC ≥ 0.25) | Card init / management |
| `openssl` | CSR signing through PKCS#11 |

macOS install one-liner:

```bash
brew install node pnpm rust opensc gp openssl
```

## Development

```bash
pnpm install
pnpm tauri dev
```

The dev server boots Vite for the frontend and Cargo for the backend,
opens a window pointed at `http://localhost:5173`.

## Production build

```bash
pnpm tauri build
# macOS:    src-tauri/target/release/bundle/dmg/*.dmg
# Windows:  src-tauri/target/release/bundle/msi/*.msi
# Linux:    src-tauri/target/release/bundle/{appimage,deb}/*
```

## Project layout

```
.
├── src/                    React + TypeScript frontend
│   ├── App.tsx
│   ├── main.tsx
│   ├── lib/api.ts          single chokepoint for `invoke()` calls
│   ├── components/         reusable UI
│   ├── views/              one component per top-level screen
│   └── types/              shared TS types
├── src-tauri/              Rust backend
│   ├── src/
│   │   ├── main.rs         tauri::Builder entry
│   │   ├── commands.rs     #[tauri::command] registry
│   │   └── services/       gp, opensc, pcsc, vault, profile
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/       allowlist for shell exec and fs
└── CLAUDE.md               contributor rules (no AI markers in commits)
```

## Architecture

- **Frontend** never spawns processes. It invokes Tauri commands via
  `src/lib/api.ts`.
- **Backend** owns all secret material. Secrets live in the OS keychain
  (`keyring` crate). Frontend gets handles (e.g. `gp-key:card-7H2K9`),
  never raw bytes.
- **Profile config** is persisted via `tauri-plugin-store` to the user
  data dir (encrypted at rest is on the roadmap).
- **Audit log** appended to a per-day file under user data dir, signed
  daily with a configurable PGP key.

## License

MIT — see [LICENSE](LICENSE).
