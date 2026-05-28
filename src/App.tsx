import { useState } from "react";
import Sidebar, { type View } from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import Dashboard from "./views/Dashboard";
import ReadersView from "./views/ReadersView";
import GpKeysView from "./views/GpKeysView";
import AppletInstallerView from "./views/AppletInstallerView";
import ProfilesView from "./views/ProfilesView";
import IssuanceView from "./views/IssuanceView";

export default function App() {
  const [view, setView] = useState<View>("dashboard");

  return (
    <>
      <Sidebar current={view} onSelect={setView} />
      <div className="main-frame">
        <div className="content">
          {view === "dashboard" && <Dashboard />}
          {view === "readers" && <ReadersView />}
          {view === "gp-keys" && <GpKeysView />}
          {view === "installer" && <AppletInstallerView />}
          {view === "profiles" && <ProfilesView />}
          {view === "issuance" && <IssuanceView />}
        </div>
        <StatusBar />
      </div>
    </>
  );
}
