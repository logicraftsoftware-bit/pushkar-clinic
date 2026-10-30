import React, { lazy, Suspense, Component, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import {initializeTabSessions} from './tab-session';
const SuperAdminApp = lazy(() => import("./superadmin/SuperAdminApp"));
import PortalEntry from "./portal/PortalEntry";
import GlobalFeedback from "./GlobalFeedback";
const SelfRegistration = lazy(() => import("./portal/SelfRegistration"));
import "./styles.css";
import "./global-feedback.css";
import "./required-fields.css";
import "sweetalert2/dist/sweetalert2.min.css";

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Application render failed", error, info); }
  render() {
    if (this.state.failed) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7fa", padding: 24 }}><div style={{ background: "white", border: "1px solid #dfe5ee", borderRadius: 14, padding: 32, textAlign: "center", maxWidth: 440 }}><h2 style={{ marginTop: 0 }}>The page could not be displayed</h2><p style={{ color: "#6f7c91" }}>Your session is safe. Reload the application and try again.</p><button style={{ border: 0, borderRadius: 9, background: "#4d78db", color: "white", padding: "10px 18px" }} onClick={() => window.location.reload()}>Reload application</button></div></div>;
    return this.props.children;
  }
}

initializeTabSessions();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <GlobalFeedback />
      <Suspense fallback={<div role="status" style={{padding:24}}>Loading workspace...</div>}>
      {window.location.pathname.startsWith("/self-registration/") ? <SelfRegistration /> : window.location.pathname.startsWith("/superadmin") ? <SuperAdminApp /> : <PortalEntry />}
      </Suspense>
    </AppErrorBoundary>
  </React.StrictMode>,
);
