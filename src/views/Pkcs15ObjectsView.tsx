import { useEffect, useState } from "react";
import { listReaders, pkcs15Dump } from "../lib/api";
import type { Reader } from "../types";
import LoadingOverlay from "../components/LoadingOverlay";

interface Section {
  name: string;
  entries: string[];
}

function splitSections(dump: string): Section[] {
  // pkcs15-tool --dump groups objects with section headers like:
  //   PIN [User PIN]
  //   ...
  //   Private RSA Key [TestKey]
  //   ...
  // We split on blank lines and treat the first non-empty line of each
  // block as the section title.
  const blocks = dump.split(/\n\s*\n/).map((b) => b.trimEnd());
  const sections: Section[] = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    const title = lines[0].trim();
    const entries = lines.slice(1).map((l) => l.replace(/^\s+/, ""));
    sections.push({ name: title, entries });
  }
  return sections;
}

export default function Pkcs15ObjectsView() {
  const [readers, setReaders] = useState<Reader[]>([]);
  const [reader, setReader] = useState("");
  const [dump, setDump] = useState("");
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setBusy(true);
    listReaders()
      .then((rs) => {
        setReaders(rs);
        const r = rs.find((r) => r.hasCard);
        if (r) setReader(r.name);
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setBusy(false));
  }, []);

  const refresh = async () => {
    if (!reader) return;
    setBusy(true);
    setErr(null);
    try {
      setDump(await pkcs15Dump(reader));
    } catch (e: unknown) {
      setErr(String(e));
      setDump("");
    } finally {
      setBusy(false);
    }
  };

  const sections = dump ? splitSections(dump) : [];

  return (
    <>
      <LoadingOverlay show={busy} label="Reading card…" />
      <h2>PKCS#15 Objects</h2>
      <div className="card">
        <p style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 0 }}>
          Lists every object the card exposes via the PKCS#15 application:
          PINs, private / public keys, certificates, data objects. Backed by
          <code> pkcs15-tool --dump</code>.
        </p>
        <div className="row">
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label>Reader</label>
            <select value={reader} onChange={(e) => setReader(e.target.value)}>
              <option value="">— pick reader with a card —</option>
              {readers.filter((r) => r.hasCard).map((r) => (
                <option key={r.name} value={r.name}>{r.name}</option>
              ))}
            </select>
          </div>
          <button className="primary" disabled={!reader || busy} onClick={refresh}>
            {busy ? "Reading…" : "Dump PKCS#15"}
          </button>
        </div>
      </div>

      {err && (
        <div className="card" style={{ borderColor: "var(--error)" }}>
          <pre>{err}</pre>
        </div>
      )}

      {sections.length === 0 && !busy && !err && (
        <div className="empty">Pick a reader and click "Dump PKCS#15".</div>
      )}

      {sections.map((s, i) => (
        <div key={i} className="card">
          <h3>{s.name}</h3>
          <pre style={{ maxHeight: 220 }}>{s.entries.join("\n")}</pre>
        </div>
      ))}
    </>
  );
}
