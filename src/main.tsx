import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { CardWatchProvider } from "./lib/cardWatch";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <CardWatchProvider>
      <App />
    </CardWatchProvider>
  </React.StrictMode>,
);
