import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App.js";

function consumeAuthCallbackFromUrl(): void {
  if (window.location.pathname !== "/auth/callback") {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const role = params.get("role");

  if (!token || !role) {
    return;
  }

  localStorage.setItem("token", token);
  localStorage.setItem("role", role);

  // Remove token from URL before the app mounts to avoid auth race conditions and token leaks.
  window.history.replaceState(null, "", import.meta.env.BASE_URL);
}

consumeAuthCallbackFromUrl();

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
