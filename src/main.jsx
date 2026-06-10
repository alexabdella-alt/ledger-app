import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import { initSentry } from "./lib/sentry.js";
import App from "./App.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

// Error monitoring — no-op unless VITE_SENTRY_DSN is set. Must run before render.
initSentry();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
