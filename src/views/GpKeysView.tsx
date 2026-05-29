import { useEffect, useState } from "react";
import { listGpKeys, generateGpKey, deleteGpKey, listReaders, lockGpKey } from "../lib/api";
import type { GpKeyHandle, Reader } from "../types";
import LoadingOverlay from "../components/LoadingOverlay";

export default function GpKeysView() {
  const [keys, setKeys] = useState<GpKeyHandle[]>([]);
  const [readers, setReaders] = useState<Reader[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    try {
      const [k, r] = await Promise.all([listGpKeys(), listReaders()]);
      setKeys(k);
      setReaders(r);
      setErr(null);
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onGenerate = async () => {
    setBusy(true);
    setErr(null);
    try {
      const k = await generateGpKey(undefined, note || undefined);
      setInfo(`Generated key ${k.id} (stored in OS keychain)`);
      setNote("");
      await refresh();
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm(`Delete ${id}? If this key still locks a card, that card will become unmanageable.`)) return;
    setBusy(true);
    try {
      await deleteGpKey(id);
      await refresh();
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onLock = async (keyId: string) => {
    const reader = readers.find((r) => r.hasCard)?.name;
    if (!reader) {
      setErr("Insert a card first.");
      return;
    }
    if (!confirm(
      `Rotate the GP key on '${reader}' to ${keyId}?\n\n` +
      `THIS IS IRREVERSIBLE. After this, only this key can manage the card.\n` +
      `Lose it → card is bricked.`,
    )) return;
    setBusy(true);
    try {
      await lockGpKey(reader, keyId);
      setInfo(`Card on '${reader}' is now locked to ${keyId}.`);
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <LoadingOverlay show={busy} label="Working on key vault…" />
      <h2>GP Keys</h2>

      <div className="card">
        <h3>New key</h3>
        <div className="row">
          <input
            placeholder="Optional note (e.g. employee email)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="primary" disabled={busy} onClick={onGenerate}>
            Generate &amp; store
          </button>
        </div>
        <p style={{ color: "var(--text-dim)", fontSize: 12 }}>
          A random 16-byte SCP02 key is generated, stored in your OS keychain,
          and shown here by handle only. The key material never reaches this
          window or any log file.
        </p>
      </div>

      {info && <div className="card" style={{ borderColor: "var(--ok)" }}>{info}</div>}
      {err && <div className="card" style={{ borderColor: "var(--error)" }}>{err}</div>}

      <div className="card">
        <h3>Keys in vault</h3>
        {keys.length === 0 ? (
          <div className="empty">No GP keys yet. Generate one above.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Handle</th>
                <th>Card serial</th>
                <th>Algorithm</th>
                <th>Created</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td><code>{k.id}</code></td>
                  <td><code>{k.cardSerial ?? "—"}</code></td>
                  <td>{k.algorithm}</td>
                  <td>{new Date(k.createdAt).toLocaleString()}</td>
                  <td>{k.note ?? ""}</td>
                  <td>
                    <button disabled={busy} onClick={() => onLock(k.id)}>Lock card</button>
                    <button className="danger" disabled={busy} onClick={() => onDelete(k.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
