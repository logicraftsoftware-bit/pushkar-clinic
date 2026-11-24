import { useEffect, useState, type FormEvent } from "react";
import { adminApi } from "./api";
type Settings = {
  enabled: boolean;
  username: string;
  sender_id: string;
  message: string;
  entity_id: string;
  template_id: string;
  entity_param: string;
  template_param: string;
  success_prefix: string;
  has_api_key?: boolean;
};
const empty: Settings = {
  enabled: false,
  username: "",
  sender_id: "",
  message: "",
  entity_id: "",
  template_id: "",
  entity_param: "",
  template_param: "",
  success_prefix: "",
};
export default function SmsGatewaySettings() {
  const [settings, setSettings] = useState(empty),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [testPhone, setTestPhone] = useState("");
  useEffect(() => {
    adminApi<Partial<Settings>>("/sms-gateway")
      .then((value) => setSettings({ ...empty, ...value }))
      .catch((e) => setError(e.message));
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const fields = Object.fromEntries(
        Object.keys(empty).map((name) => [
          name,
          settings[name as keyof Settings],
        ])
      );
      const saved = await adminApi<Settings>("/sms-gateway", {
        method: "PUT",
        body: JSON.stringify({ ...fields, api_key: key || undefined }),
      });
      setSettings({ ...empty, ...saved });
      setKey("");
      setMessage("SMS gateway settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save");
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setError("");
    try {
      const result = await adminApi<{ message: string }>("/sms-gateway/test", {
        method: "POST",
        body: JSON.stringify({ phone: testPhone }),
      });
      setMessage(result.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(false);
    }
  }
  const fields: [keyof Settings, string, string][] = [
    ["username", "Gateway username", "text"],
    ["sender_id", "Approved sender ID", "text"],
    ["entity_id", "DLT entity ID", "text"],
    ["template_id", "DLT template ID", "text"],
    ["entity_param", "Entity API parameter name (if required)", "text"],
    ["template_param", "Template API parameter name (if required)", "text"],
    ["success_prefix", "Documented successful-response prefix", "text"],
  ];
  return (
    <section className="entity-section" style={{ marginBottom: 24 }}>
      <div className="entity-section-title">
        <div>
          <h2>Patient App · SMS Gateway</h2>
          <p>
            Dove / mobiCOMM OTP delivery for registration, login and password
            recovery.
          </p>
        </div>
      </div>
      <form onSubmit={save}>
        <div className="entity-fields">
          <label
            className="wide"
            style={{ display: "flex", gap: 10, alignItems: "center" }}
          >
            <input
              type="checkbox"
              style={{ width: 20, height: 20 }}
              checked={settings.enabled}
              onChange={(e) =>
                setSettings({ ...settings, enabled: e.target.checked })
              }
            />
            Enable this SMS gateway
          </label>
          <p className="wide">
            OTPs use Dove&apos;s submitsms.jsp HTTPS request. The server sends the
            configured entity and template IDs as entityid and tempid. Use the
            exact approved message, replacing only its OTP variable with{" "}
            {"{code}"}. Save the API key here; it is encrypted and is never
            returned to the browser.
          </p>
          {fields.map(([name, label, type]) => (
            <label key={name}>
              <span>{label}</span>
              <input
                type={type}
                value={String(settings[name] ?? "")}
                onChange={(e) =>
                  setSettings({ ...settings, [name]: e.target.value })
                }
              />
            </label>
          ))}
          <label>
            <span>
              API key{" "}
              {settings.has_api_key ? "(configured; leave blank to keep)" : ""}
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                settings.has_api_key
                  ? "Saved securely"
                  : "Enter the new API key"
              }
            />
          </label>
          <label className="wide">
            <span>Approved OTP message</span>
            <textarea
              rows={3}
              value={settings.message}
              onChange={(e) =>
                setSettings({ ...settings, message: e.target.value })
              }
            />
          </label>
          <p className="wide">
            Enter the approved DLT entity ID and content-template ID. The
            parameter names are fixed to entityid and tempid for this gateway;
            leave the optional custom parameter-name fields blank. Set the
            successful-response prefix to the exact prefix documented by Dove
            (for example, sent,success, if that is the response your account
            returns). HTTP 200 alone does not confirm provider acceptance.
          </p>
          {error && (
            <p role="alert" className="entity-error wide">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="wide">
              {message}
            </p>
          )}
        </div>
        <div className="entity-actionbar">
          <button className="sa-primary" disabled={busy}>
            Save SMS gateway
          </button>
        </div>
      </form>
      <div className="entity-fields">
        <label>
          <span>Test mobile number (+91…)</span>
          <input
            type="tel"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
          />
        </label>
        <div>
          <button
            type="button"
            className="sa-secondary"
            disabled={busy || !settings.enabled || !testPhone}
            onClick={test}
          >
            Send test SMS
          </button>
          <p>
            This sends a billable provider message, not a login code. Check its
            delivery report in your gateway.
          </p>
        </div>
      </div>
    </section>
  );
}
