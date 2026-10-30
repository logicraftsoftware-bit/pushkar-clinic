import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";

type Toast = { id: number; message: string; failed:boolean };

export default function GlobalFeedback() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      const method = String(init?.method ?? "GET").toUpperCase();
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : input.toString();
      if (
        response.ok &&
        ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
        !url.includes("/auth/login") &&
        !url.includes("/auth/logout") &&
        !url.includes("/ai-assistant/chat")
      ) {
        const message =
          method === "DELETE"
            ? "Deleted successfully"
            : method === "PUT" || method === "PATCH"
              ? "Updated successfully"
              : "Saved successfully";
        window.dispatchEvent(
          new CustomEvent("app-success", { detail: message }),
        );
      }
      if(!response.ok&&url.includes('/api/v1/')&&!url.includes('/auth/login')&&!url.includes('/session/events')){
        const data=await response.clone().json().catch(()=>null);
        if(response.status===401&&data?.code==='ACCESS_REVOKED')window.dispatchEvent(new CustomEvent('session-invalid',{detail:data.error}));
        else if(data?.code==='PASSWORD_CHANGE_REQUIRED')window.dispatchEvent(new Event('password-change-required'));
        else if([400,403,409,422,429].includes(response.status))window.dispatchEvent(new CustomEvent('app-error',{detail:data?.field?`${data.field}: ${data.error}`:data?.error||`Request blocked (${response.status}). Please try again.`}));
      }
      if(response.status===403&&!url.includes('/access-control/me'))window.dispatchEvent(new Event('access-updated'));
      return response;
    };

    const notify = (event: Event) => {
      const id = Date.now() + Math.random();
      const message = (event as CustomEvent<string>).detail;
      const failed=event.type==='app-error';
      setToasts((items) => items.some(item=>item.message===message)?items:[...items.slice(-3), { id, message,failed }]);
      window.setTimeout(
        () => setToasts((items) => items.filter((item) => item.id !== id)),
        3500,
      );
    };
    window.addEventListener("app-success", notify);
    window.addEventListener("app-error", notify);
    return () => {
      window.fetch = originalFetch;
      window.removeEventListener("app-success", notify);
      window.removeEventListener("app-error", notify);
    };
  }, []);

  return (
    <div className="global-toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`global-toast ${toast.failed?'global-toast-error':''}`} key={toast.id} role={toast.failed?'alert':'status'}>
          {toast.failed?<AlertTriangle/>:<CheckCircle2 />}
          <div>
            <strong>{toast.failed?'Action blocked':'Success'}</strong>
            <span>{toast.message}</span>
          </div>
          <button
            aria-label="Dismiss notification"
            onClick={() =>
              setToasts((items) => items.filter((item) => item.id !== toast.id))
            }
          >
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}
