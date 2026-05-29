import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import UpdaterWindow from "./views/UpdaterWindow";
import AboutWindow from "./views/AboutWindow";
import { CardWatchProvider } from "./lib/cardWatch";
import "./index.css";

// The same bundle serves every window; secondary windows render their own
// standalone UI (by window label) instead of the full app shell.
function currentLabel(): string {
  try {
    // Read synchronously from Tauri internals; no IPC, no permission needed.
    const internals = (window as unknown as {
      __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
    }).__TAURI_INTERNALS__;
    return internals?.metadata?.currentWindow?.label ?? "main";
  } catch {
    return "main";
  }
}

function Root() {
  switch (currentLabel()) {
    case "updater":
      return <UpdaterWindow />;
    case "about":
      return <AboutWindow />;
    default:
      return (
        <CardWatchProvider>
          <App />
        </CardWatchProvider>
      );
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
