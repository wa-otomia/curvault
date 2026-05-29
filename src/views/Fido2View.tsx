import { useEffect, useState } from "react";
import {
  fido2ListDevices,
  fido2Info,
  fido2ListCredentials,
  fido2DeleteCredential,
  fido2SetPin,
  fido2Reset,
} from "../lib/api";
import type { Fido2Device, Fido2Info, ResidentCredential } from "../types";
import LoadingOverlay from "../components/LoadingOverlay";

/**
 * libfido2 prints the user id as base64. Most RPs encode a readable
 * display string into that field (webauthn.io for instance encodes
 * "webauthn.io-vaag"), so we try to decode it. If the bytes don't form
 * valid printable UTF-8, fall back to the raw base64 — never throw.
 */
function decodeUserId(b64: string | undefined | null): string | null {
  if (!b64) return null;
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    // Printable ASCII / common whitespace only.
    if (text.length > 0 && /^[\x20-\x7E\s]+$/.test(text)) return text;
    return b64;
  } catch {
    return b64;
  }
}

/** Visible head + tail with an ellipsis for very long base64 ids. */
function shortenCredId(id: string): string {
  if (id.length <= 28) return id;
  return `${id.slice(0, 14)}…${id.slice(-10)}`;
}

export default function Fido2View() {
  const [devices, setDevices] = useState<Fido2Device[]>([]);
  const [selected, setSelected] = useState<Fido2Device | null>(null);
  const [info, setInfo] = useState<Fido2Info | null>(null);
  const [creds, setCreds] = useState<ResidentCredential[] | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshDevices = async () => {
    setErr(null);
    setBusy(true);
    try {
      setDevices(await fido2ListDevices());
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refreshDevices();
  }, []);

  const onSelect = async (d: Fido2Device) => {
    setSelected(d);
    setInfo(null);
    setCreds(null);
    setBusy(true);
    setErr(null);
    try {
      setInfo(await fido2Info(d.path));
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onListCreds = async () => {
    if (!selected) return;
    // Empty PIN is allowed: the authenticator may have no clientPin set
    // (the device info shows the `noclientPin` option). The backend will
    // close stdin instead of feeding a blank PIN.
    setBusy(true);
    setErr(null);
    try {
      setCreds(await fido2ListCredentials(selected.path, pin));
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteCred = async (cred: ResidentCredential) => {
    if (!selected) return;
    if (!confirm(`Delete credential for ${cred.rpId}? The user will lose passwordless login for that site.`)) return;
    setBusy(true);
    try {
      await fido2DeleteCredential({
        devicePath: selected.path,
        credentialId: cred.credentialId,
        pin,
      });
      setNotice(`Deleted ${cred.credentialId.slice(0, 16)}…`);
      await onListCreds();
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onChangePin = async () => {
    if (!selected) return;
    const oldPin = prompt("Current PIN (leave empty if device has no PIN yet):") ?? "";
    const newPin = prompt("New PIN (4-63 chars):") ?? "";
    if (!newPin) return;
    setBusy(true);
    try {
      await fido2SetPin({
        devicePath: selected.path,
        oldPin: oldPin || undefined,
        newPin,
      });
      setNotice("PIN updated.");
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onReset = async () => {
    if (!selected) return;
    if (!confirm(
      "FACTORY RESET this authenticator?\n\n" +
      "All resident credentials and the PIN will be wiped. " +
      "The reset window is ~10s after the device is plugged in / tapped. " +
      "Re-insert the device, then click OK quickly.",
    )) return;
    setBusy(true);
    try {
      await fido2Reset(selected.path);
      setNotice("Reset issued. Authenticator should be blank.");
      setCreds(null);
      setInfo(null);
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <LoadingOverlay show={busy} label="Talking to authenticator…" />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>FIDO2 Authenticators</h2>
        <button onClick={refreshDevices}>Refresh</button>
      </div>

      {err && <div className="card" style={{ borderColor: "var(--error)" }}><pre>{err}</pre></div>}
      {notice && <div className="card" style={{ borderColor: "var(--ok)" }}>{notice}</div>}

      <div className="card">
        <h3>Devices</h3>
        {devices.length === 0 ? (
          <div className="empty">No FIDO2 authenticators detected. Plug one in or tap an NFC reader.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Path</th><th>Product</th><th>Vendor</th><th></th></tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.path} style={{ background: selected?.path === d.path ? "var(--bg-input)" : "transparent" }}>
                  <td><code>{d.path}</code></td>
                  <td>{d.product}</td>
                  <td>{d.vendor}</td>
                  <td><button onClick={() => onSelect(d)}>Select</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div className="card">
          <h3>Selected: {selected.product}</h3>
          <div className="row">
            <button onClick={onChangePin} disabled={busy}>Set / change PIN</button>
            <button onClick={onReset} className="danger" disabled={busy}>Factory reset</button>
          </div>

          {info && (
            <div style={{ marginTop: "1rem" }}>
              <div className="row">
                {info.aaguid && (
                  <div>
                    <div style={{ color: "var(--text-dim)", fontSize: 12 }}>AAGUID</div>
                    <code>{info.aaguid}</code>
                  </div>
                )}
                <div>
                  <div style={{ color: "var(--text-dim)", fontSize: 12 }}>PIN retries</div>
                  <code>{info.pinRetries ?? "—"}</code>
                </div>
                <div>
                  <div style={{ color: "var(--text-dim)", fontSize: 12 }}>UV retries</div>
                  <code>{info.uvRetries ?? "—"}</code>
                </div>
              </div>

              <div className="row" style={{ marginTop: ".75rem" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Versions</div>
                  <code>{info.versions.join(", ") || "—"}</code>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Extensions</div>
                  <code>{info.extensions.join(", ") || "—"}</code>
                </div>
              </div>

              <div style={{ marginTop: ".75rem" }}>
                <div style={{ color: "var(--text-dim)", fontSize: 12 }}>Options</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: ".5rem" }}>
                  {info.options.map(([name, enabled]) => (
                    <span key={name} style={{
                      padding: "0.15rem 0.4rem",
                      borderRadius: 4,
                      background: enabled ? "rgba(76,175,122,0.2)" : "rgba(227,95,95,0.2)",
                      color: enabled ? "var(--ok)" : "var(--error)",
                      fontSize: 12,
                    }}>
                      {enabled ? "" : "!"}{name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {selected && (
        <div className="card">
          <h3>Resident credentials</h3>
          <div className="row" style={{ marginBottom: "0.5rem" }}>
            <input
              type="password"
              placeholder="Device PIN (leave empty if the device has no PIN)"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              style={{ flex: 1 }}
            />
            <button onClick={onListCreds} disabled={busy}>List credentials</button>
          </div>
          <small style={{ color: "var(--text-dim)", fontSize: 11, marginBottom: "0.75rem", display: "block" }}>
            This authenticator reports <code>noclientPin</code> when no PIN is set — leave
            the field blank and it will enumerate without PIN auth.
          </small>
          {creds === null ? (
            <div className="empty">Click "List credentials" (enter the PIN first if the device has one).</div>
          ) : creds.length === 0 ? (
            <div className="empty">No resident credentials on this device.</div>
          ) : (
            <table style={{ tableLayout: "fixed", width: "100%" }}>
              <colgroup>
                <col style={{ width: "22%" }} />
                <col style={{ width: "30%" }} />
                <col style={{ width: "38%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>
              <thead>
                <tr><th>RP ID</th><th>User</th><th>Credential ID</th><th></th></tr>
              </thead>
              <tbody>
                {creds.map((c) => {
                  const decoded =
                    decodeUserId(c.userName) ?? c.userDisplayName ?? null;
                  // Show the display name if libfido2 actually returned one
                  // and it differs from the decoded user id.
                  const showDisplay =
                    c.userDisplayName &&
                    c.userDisplayName !== c.userName &&
                    c.userDisplayName !== decoded;
                  return (
                    <tr key={c.credentialId}>
                      <td style={{ overflow: "hidden", textOverflow: "ellipsis" }}
                          title={c.rpId}>
                        {c.rpId}
                      </td>
                      <td title={c.userName ?? ""}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {decoded ?? "—"}
                        </div>
                        {showDisplay && (
                          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
                            {c.userDisplayName}
                          </div>
                        )}
                      </td>
                      <td title={c.credentialId}>
                        <code style={{ fontSize: 11 }}>{shortenCredId(c.credentialId)}</code>
                      </td>
                      <td>
                        <button className="danger" onClick={() => onDeleteCred(c)} disabled={busy}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
