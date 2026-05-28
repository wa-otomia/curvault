export type View =
  | "dashboard"
  | "readers"
  | "applets"
  | "gp-keys"
  | "installer"
  | "pkcs15"
  | "pkcs15-objects"
  | "pkcs11-objects"
  | "profiles"
  | "fido2"
  | "issuance"
  | "sticker";

const NAV: { id: View; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "readers",   label: "Readers" },
  { id: "applets",   label: "Installed Applets" },
  { id: "gp-keys",   label: "GP Keys" },
  { id: "installer", label: "Applet Installer" },
  { id: "pkcs15",    label: "PKCS#15 Init" },
  { id: "pkcs15-objects", label: "PKCS#15 Objects" },
  { id: "pkcs11-objects", label: "PKCS#11 Objects" },
  { id: "profiles",  label: "Profiles" },
  { id: "fido2",     label: "FIDO2" },
  { id: "issuance",  label: "Issuance" },
  { id: "sticker",   label: "Card Sticker" },
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
        <svg width="36" height="36" viewBox="0 0 120 120" className="brand-logo">
          <defs>
            <linearGradient id="brandBg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#36c5ff" />
              <stop offset="1" stopColor="#1b4fd6" />
            </linearGradient>
          </defs>
          <path d="M 86.87 33.13 A 38 38 0 1 0 86.87 86.87" fill="none" stroke="url(#brandBg)" strokeWidth="9" strokeLinecap="round" />
          <path d="M 76.97 43.03 A 24 24 0 1 0 76.97 76.97" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity=".9" />
          <circle cx="60" cy="60" r="6.5" fill="#fff" />
        </svg>
        <span className="brand-name">Curvault</span>
        <svg
          className="brand-nfc"
          width="20" height="20" viewBox="0 0 40 40" fill="none"
          stroke="#dbe6fb" strokeWidth="3.6" strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M14 12 A 14 14 0 0 1 14 28" />
          <path d="M20 9 A 20 20 0 0 1 20 31" />
          <path d="M26 6 A 26 26 0 0 1 26 34" />
        </svg>
      </div>

      <div className="sidebar-nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${current === item.id ? "active" : ""}`}
            onClick={() => onSelect(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <svg
        className="sidebar-waves"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="sideWaveGrad" x1="0" y1="0" x2="1" y2="0.3">
            <stop offset="0" stopColor="#36c5ff" stopOpacity="0" />
            <stop offset=".5" stopColor="#3f8bff" stopOpacity=".9" />
            <stop offset="1" stopColor="#1b4fd6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g
          fill="none"
          stroke="url(#sideWaveGrad)"
          strokeLinecap="round"
          transform="rotate(-14 50 60)"
        >
          <path d="M-20 40 C 20 20, 60 64, 130 30" strokeWidth=".55" opacity=".9" />
          <path d="M-20 48 C 20 28, 60 72, 130 38" strokeWidth=".5"  opacity=".75" />
          <path d="M-20 56 C 20 36, 60 80, 130 46" strokeWidth=".5"  opacity=".6" />
          <path d="M-20 64 C 20 44, 60 88, 130 54" strokeWidth=".45" opacity=".48" />
          <path d="M-20 72 C 20 52, 60 96, 130 62" strokeWidth=".45" opacity=".36" />
          <path d="M-20 80 C 20 60, 60 104, 130 70" strokeWidth=".4"  opacity=".26" />
          <path d="M-20 88 C 20 68, 60 112, 130 78" strokeWidth=".4"  opacity=".18" />
        </g>
      </svg>
    </nav>
  );
}
