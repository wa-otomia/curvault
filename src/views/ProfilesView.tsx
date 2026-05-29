import { useEffect, useState } from "react";
import { listProfiles, saveProfile, deleteProfile } from "../lib/api";
import type { Profile, KeyPlanEntry } from "../types";
import LoadingOverlay from "../components/LoadingOverlay";
import { confirmAction } from "../lib/dialog";

const blankProfile = (): Profile => ({
  id: crypto.randomUUID(),
  name: "New profile",
  description: "",
  pkcs15: {
    label: "ACME Smartcard",
    manufacturer: "ACME Corp",
    serialScheme: "cplc",
  },
  pin: { lengthMin: 8, lengthMax: 16, generation: "random" },
  puk: { length: 16, generation: "random" },
  keys: [
    {
      slotId: 1,
      label: "auth",
      type: "ec",
      size: 256,
      curve: "prime256v1",
      certValidityDays: 730,
      certSubjectTemplate: "/CN={email}/O={org}/OU=auth",
    },
  ],
});

export default function ProfilesView() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    setBusy(true);
    try {
      setProfiles(await listProfiles());
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const startNew = () => setEditing(blankProfile());

  const onSave = async () => {
    if (!editing) return;
    try {
      await saveProfile(editing);
      setEditing(null);
      await refresh();
    } catch (e: unknown) {
      setErr(String(e));
    }
  };

  const onDelete = async (id: string) => {
    if (!(await confirmAction("Delete this profile?", { title: "Delete profile", danger: true, okLabel: "Delete" }))) return;
    try {
      await deleteProfile(id);
      await refresh();
    } catch (e: unknown) {
      setErr(String(e));
    }
  };

  if (editing) return <ProfileEditor profile={editing} onChange={setEditing} onSave={onSave} onCancel={() => setEditing(null)} />;

  return (
    <>
      <LoadingOverlay show={busy} label="Loading profiles…" />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Profiles</h2>
        <button className="primary" onClick={startNew}>+ New profile</button>
      </div>

      <div className="card" style={{ borderColor: "rgba(54,197,255,0.2)" }}>
        <p style={{ margin: 0, color: "var(--text-dim)", fontSize: 13, lineHeight: 1.55 }}>
          A profile defines what an issued card should look like: the PKCS#15
          token info (label, manufacturer ID, serial scheme), PIN / PUK
          policy, the set of keys to provision, and the CA endpoint. These
          values are fed to <code>pkcs15-init</code> via a synthesized OpenSC
          profile directory at issuance time — so think of this as the
          <strong> issuer-side template for the OpenSC pkcs15-init profile</strong>.
        </p>
      </div>

      {err && <div className="card" style={{ borderColor: "var(--error)" }}><pre>{err}</pre></div>}

      <div className="card">
        {profiles.length === 0 ? (
          <div className="empty">No profiles yet. Click "+ New profile" to create one.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Label</th>
                <th>Manufacturer</th>
                <th>Keys</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.pkcs15.label}</td>
                  <td>{p.pkcs15.manufacturer}</td>
                  <td>{p.keys.length}</td>
                  <td>
                    <button onClick={() => setEditing({ ...p })}>Edit</button>
                    <button className="danger" onClick={() => onDelete(p.id)}>Delete</button>
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

function ProfileEditor({
  profile,
  onChange,
  onSave,
  onCancel,
}: {
  profile: Profile;
  onChange: (p: Profile) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const update = (mut: (p: Profile) => void) => {
    const copy = structuredClone(profile);
    mut(copy);
    onChange(copy);
  };

  const addKey = () => update((p) => {
    p.keys.push({
      slotId: Math.max(0, ...p.keys.map((k) => k.slotId)) + 1,
      label: `key${p.keys.length + 1}`,
      type: "ec",
      size: 256,
      curve: "prime256v1",
      certValidityDays: 730,
      certSubjectTemplate: "/CN={email}",
    });
  });

  const removeKey = (idx: number) => update((p) => { p.keys.splice(idx, 1); });

  const updateKey = (idx: number, mut: (k: KeyPlanEntry) => void) =>
    update((p) => mut(p.keys[idx]));

  return (
    <>
      <h2>Edit profile</h2>
      <div className="card">
        <h3>General</h3>
        <div className="field">
          <label>Name</label>
          <input value={profile.name} onChange={(e) => update((p) => { p.name = e.target.value; })} />
        </div>
        <div className="field">
          <label>Description</label>
          <input
            value={profile.description ?? ""}
            onChange={(e) => update((p) => { p.description = e.target.value; })}
          />
        </div>
      </div>

      <div className="card">
        <h3>PKCS#15 token info</h3>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Label</label>
            <input
              value={profile.pkcs15.label}
              onChange={(e) => update((p) => { p.pkcs15.label = e.target.value; })}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Manufacturer ID</label>
            <input
              value={profile.pkcs15.manufacturer}
              onChange={(e) => update((p) => { p.pkcs15.manufacturer = e.target.value; })}
            />
          </div>
        </div>
        <div className="field">
          <label>Serial scheme</label>
          <select
            value={profile.pkcs15.serialScheme}
            onChange={(e) => update((p) => { p.pkcs15.serialScheme = e.target.value as Profile["pkcs15"]["serialScheme"]; })}
          >
            <option value="cplc">CPLC chip serial</option>
            <option value="uuid">Random UUID</option>
            <option value="incremental">Incremental counter</option>
            <option value="template">Template</option>
          </select>
        </div>
        {profile.pkcs15.serialScheme === "template" && (
          <div className="field">
            <label>Serial template (use {"{counter}"}, {"{date}"}, {"{cplc}"})</label>
            <input
              value={profile.pkcs15.serialTemplate ?? ""}
              onChange={(e) => update((p) => { p.pkcs15.serialTemplate = e.target.value; })}
              placeholder="ACME-{counter:08d}"
            />
          </div>
        )}
      </div>

      <div className="card">
        <h3>PIN / PUK</h3>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>PIN min length</label>
            <input
              type="number" min={4} max={16}
              value={profile.pin.lengthMin}
              onChange={(e) => update((p) => { p.pin.lengthMin = Number(e.target.value); })}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>PIN max length</label>
            <input
              type="number" min={4} max={16}
              value={profile.pin.lengthMax}
              onChange={(e) => update((p) => { p.pin.lengthMax = Number(e.target.value); })}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>PIN generation</label>
            <select
              value={profile.pin.generation}
              onChange={(e) => update((p) => { p.pin.generation = e.target.value as Profile["pin"]["generation"]; })}
            >
              <option value="random">Random</option>
              <option value="fixed">Fixed</option>
              <option value="user-chosen">User-chosen</option>
            </select>
          </div>
        </div>
        <p style={{ color: "var(--text-dim)", fontSize: 12 }}>
          PUK is fixed at 16 bytes by IsoApplet.
        </p>
      </div>

      <div className="card">
        <h3>Keys to provision</h3>
        {profile.keys.map((k, i) => (
          <div key={i} className="row" style={{ marginBottom: "0.5rem" }}>
            <input
              style={{ width: 60 }}
              type="number" value={k.slotId}
              onChange={(e) => updateKey(i, (kk) => { kk.slotId = Number(e.target.value); })}
            />
            <input
              style={{ width: 120 }}
              value={k.label}
              onChange={(e) => updateKey(i, (kk) => { kk.label = e.target.value; })}
            />
            <select
              value={k.type}
              onChange={(e) => updateKey(i, (kk) => { kk.type = e.target.value as KeyPlanEntry["type"]; })}
            >
              <option value="ec">EC</option>
              <option value="rsa">RSA</option>
            </select>
            <input
              style={{ width: 80 }}
              type="number" value={k.size}
              onChange={(e) => updateKey(i, (kk) => { kk.size = Number(e.target.value); })}
            />
            <input
              style={{ flex: 1 }}
              placeholder="Subject template"
              value={k.certSubjectTemplate}
              onChange={(e) => updateKey(i, (kk) => { kk.certSubjectTemplate = e.target.value; })}
            />
            <button className="danger" onClick={() => removeKey(i)}>×</button>
          </div>
        ))}
        <button onClick={addKey}>+ Add key</button>
      </div>

      <div className="row">
        <button className="primary" onClick={onSave}>Save profile</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}
