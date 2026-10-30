const SESSION_KEY = "careframe_portal_session";

// Seed the same-origin tab before loading the application, then detach its opener.
export function openWorkspaceTab(url: URL, browser: Pick<Window, "location" | "sessionStorage" | "open"> = window) {
  if (url.origin !== browser.location.origin) throw new Error("Workspace tabs must use the ERP origin");
  const destination = new URL(url.href);
  destination.searchParams.set("_workspace", String(Date.now()));
  const tab = browser.open("about:blank", "_blank");
  if (!tab) {
    browser.location.assign(destination.href);
    return;
  }
  try {
    const session = browser.sessionStorage.getItem(SESSION_KEY);
    if (session) tab.sessionStorage.setItem(SESSION_KEY, session);
    const hint=browser.sessionStorage.getItem(`${SESSION_KEY}_tab_hint`);
    if(session&&hint)tab.sessionStorage.setItem(`${SESSION_KEY}_tab_hint`,hint);
    tab.opener = null;
    tab.location.replace(destination.href);
  } catch {
    tab.close();
    browser.location.assign(destination.href);
  }
}
