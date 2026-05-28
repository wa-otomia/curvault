export type View =
  | "dashboard"
  | "readers"
  | "gp-keys"
  | "installer"
  | "pkcs15"
  | "profiles"
  | "fido2"
  | "issuance";

const NAV: { id: View; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "readers",   label: "Readers" },
  { id: "gp-keys",   label: "GP Keys" },
  { id: "installer", label: "Applet Installer" },
  { id: "pkcs15",    label: "PKCS#15 Init" },
  { id: "profiles",  label: "Profiles" },
  { id: "fido2",     label: "FIDO2" },
  { id: "issuance",  label: "Issuance" },
];

export default function Sidebar({
  current,
  onSelect,
}: {
  current: View;
  onSelect: (v: View) => void;
}) {
  return (
    <nav className="sidebar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 120 120" style={{ verticalAlign: "middle", marginRight: 8 }}>
          <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#36c5ff" />
              <stop offset="1" stopColor="#1b4fd6" />
            </linearGradient>
          </defs>
          <path d="M 86.87 33.13 A 38 38 0 1 0 86.87 86.87" fill="none" stroke="url(#bg)" strokeWidth="9" strokeLinecap="round" />
          <path d="M 76.97 43.03 A 24 24 0 1 0 76.97 76.97" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity=".9" />
          <circle cx="60" cy="60" r="6.5" fill="#fff" />
        </svg>
        Curvault
      </div>
      {NAV.map((item) => (
        <button
          key={item.id}
          className={`nav-item ${current === item.id ? "active" : ""}`}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
