import { useEffect, useState } from "react";
import {
  listReaders,
  listProfiles,
  runIssuance,
  onIssuanceProgress,
} from "../lib/api";
import type { Reader, Profile, IssuanceReport } from "../types";

export default function IssuanceView() {
  const [readers, setReaders] = useState<Reader[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reader, setReader] = useState("");
  const [profileId, setProfileId] = useState("");
  const [email, setEmail] = useState("");
  const [empId, setEmpId] = useState("");
  const [report, setReport] = useState<IssuanceReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listReaders(), listProfiles()]).then(([r, p]) => {
      setReaders(r);
      setProfiles(p);
      if (r.length) setReader(r[0].name);
      if (p.length) setProfileId(p[0].id);
    });
    let unsub = () => {};
    onIssuanceProgress((r) => setReport(r)).then((u) => { unsub = u; });
    return () => unsub();
  }, []);

  const onStart = async () => {
    if (!reader || !profileId) return;
    setBusy(true);
    setErr(null);
    setReport(null);
    try {
      const r = await runIssuance(reader, profileId, { email, empId });
      setReport(r);
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>Issuance</h2>

      <div className="card">
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Reader</label>
            <select value={reader} onChange={(e) => setReader(e.target.value)}>
              {readers.filter((r) => r.hasCard).map((r) => (
                <option key={r.name} value={r.name}>{r.name}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Profile</label>
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Subject email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="alice@example.com" />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Employee ID</label>
            <input value={empId} onChange={(e) => setEmpId(e.target.value)} placeholder="12345" />
          </div>
        </div>
        <button className="primary" disabled={busy || !reader || !profileId} onClick={onStart}>
          Start issuance
        </button>
      </div>

      {err && <div className="card" style={{ borderColor: "var(--error)" }}><pre>{err}</pre></div>}

      {report && (
        <div className="card">
          <h3>
            Status: <span style={{
              color: report.status === "ok" ? "var(--ok)" :
                     report.status === "failed" ? "var(--error)" : "var(--warn)",
            }}>{report.status}</span>
          </h3>
          <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
            Card {report.cardSerial} · profile {report.profileId} · started {new Date(report.startedAt).toLocaleString()}
          </div>
          <table style={{ marginTop: "1rem" }}>
            <thead>
              <tr>
                <th>Step</th>
                <th>Status</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {report.steps.map((s, i) => (
                <tr key={i}>
                  <td>{s.name}</td>
                  <td>{s.status}</td>
                  <td><code>{s.detail ?? ""}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
