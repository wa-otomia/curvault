import { useEffect, useState } from "react";
import { listReaders, listProfiles, listGpKeys } from "../lib/api";
import type { Reader, Profile, GpKeyHandle } from "../types";
import LoadingOverlay from "../components/LoadingOverlay";

export default function Dashboard() {
  const [readers, setReaders] = useState<Reader[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [keys, setKeys] = useState<GpKeyHandle[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setBusy(true);
    Promise.all([listReaders(), listProfiles(), listGpKeys()])
      .then(([r, p, k]) => {
        setReaders(r);
        setProfiles(p);
        setKeys(k);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  }, []);

  if (err) {
    return (
      <div className="card">
        <h3>Backend error</h3>
        <pre>{err}</pre>
        <p>
          Make sure <code>gp</code>, <code>opensc-tool</code> and{" "}
          <code>pkcs15-init</code> are installed and on your <code>$PATH</code>.
        </p>
      </div>
    );
  }

  return (
    <>
      <LoadingOverlay show={busy} label="Loading overview…" />
      <h2>Overview</h2>
      <div className="row" style={{ gap: "1rem", alignItems: "stretch" }}>
        <StatCard label="Readers" value={readers.length} />
        <StatCard label="Cards present" value={readers.filter((r) => r.hasCard).length} />
        <StatCard label="GP keys in vault" value={keys.length} />
        <StatCard label="Profiles" value={profiles.length} />
      </div>

      <div className="card">
        <h3>Next steps</h3>
        <ol>
          <li>Plug a reader and confirm it shows up under <strong>Readers</strong>.</li>
          <li>Define at least one <strong>Profile</strong> describing what cards should look like.</li>
          <li>Generate a per-card GP key under <strong>GP Keys</strong> (or accept the default for testing).</li>
          <li>Install the IsoApplet CAP via <strong>Applet Installer</strong>.</li>
          <li>Run the full <strong>Issuance</strong> flow to put PIN/PUK/keys/certs on the card.</li>
        </ol>
      </div>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card" style={{ flex: 1, marginBottom: 0 }}>
      <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
