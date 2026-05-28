export type View =
  | "dashboard"
  | "readers"
  | "gp-keys"
  | "installer"
  | "profiles"
  | "issuance";

const NAV: { id: View; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "readers",   label: "Readers" },
  { id: "gp-keys",   label: "GP Keys" },
  { id: "installer", label: "Applet Installer" },
  { id: "profiles",  label: "Profiles" },
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
      <div className="brand">Smartcard Issuer</div>
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
