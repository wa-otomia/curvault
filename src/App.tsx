import { useState } from "react";
import Sidebar, { type View } from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import LogPanel from "./components/LogPanel";
import Dashboard from "./views/Dashboard";
import ReadersView from "./views/ReadersView";
import AppletsView from "./views/AppletsView";
import GpKeysView from "./views/GpKeysView";
import AppletInstallerView from "./views/AppletInstallerView";
import Pkcs15View from "./views/Pkcs15View";
import Pkcs15ObjectsView from "./views/Pkcs15ObjectsView";
import Pkcs11ObjectsView from "./views/Pkcs11ObjectsView";
import ProfilesView from "./views/ProfilesView";
import Fido2View from "./views/Fido2View";
import IssuanceView from "./views/IssuanceView";
import StickerView from "./views/StickerView";

export default function App() {
  const [view, setView] = useState<View>("dashboard");

  return (
    <>
      <Sidebar current={view} onSelect={setView} />
      <div className="main-frame">
        <div className="content">
          {view === "dashboard" && <Dashboard />}
          {view === "readers" && <ReadersView />}
          {view === "applets" && <AppletsView />}
          {view === "gp-keys" && <GpKeysView />}
          {view === "installer" && <AppletInstallerView />}
          {view === "pkcs15" && <Pkcs15View />}
          {view === "pkcs15-objects" && <Pkcs15ObjectsView />}
          {view === "pkcs11-objects" && <Pkcs11ObjectsView />}
          {view === "profiles" && <ProfilesView />}
          {view === "fido2" && <Fido2View />}
          {view === "issuance" && <IssuanceView />}
          {view === "sticker" && <StickerView />}
        </div>
        <LogPanel />
        <StatusBar />
      </div>
    </>
  );
}
