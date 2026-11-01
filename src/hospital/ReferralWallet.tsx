import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  BadgeIndianRupee,
  CheckCircle2,
  Clock3,
  Pencil,
  Percent,
  Plus,
  RefreshCw,
  Search,
  Users,
  WalletCards,
} from "lucide-react";
import Swal from "sweetalert2";
import "./referral-wallet.css";
const API =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD ? "" : "http://localhost:4000");
type Row = Record<string, any>;
async function call(path: string, token: string, o: RequestInit = {}) {
  const r = await fetch(`${API}/api/v1/referrals${path}`, {
      ...o,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...o.headers,
      },
    }),
    d = await r.json();
  if (!r.ok) throw new Error(d.error || "Referral request failed");
  return d;
}
const money = (n: any) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function ReferralAdmin({ token }: { token: string }) {
  const [tab, setTab] = useState("Partners"),
    [partners, setPartners] = useState<Row[]>([]),
    [rules, setRules] = useState<Row[]>([]),
    [data, setData] = useState<Row>({
      summary: {},
      commissions: [],
      withdrawals: [],
      transactions: [],
    }),
    [adding, setAdding] = useState(false),
    [editingPartner, setEditingPartner] = useState<Row | null>(null),
    [commissionPartner, setCommissionPartner] = useState<Row | null>(null),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setError("");
      const [p, r, d] = await Promise.all([
        call("/partners", token),
        call("/rules", token),
        call("/admin-dashboard", token),
      ]);
      setPartners(p);
      setRules(r);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load");
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);
  async function action(path: string, body: Row) {
    try {
      await call(path, token, { method: "POST", body: JSON.stringify(body) });
      void load();
    } catch (e) {
      Swal.fire(
        "Unable to update",
        e instanceof Error ? e.message : "Request failed",
        "error",
      );
    }
  }
  const s = data.summary || {};
  return (
    <section className="rw-page">
      <header>
        <div>
          <small>Clinic / CRM / Accounts</small>
          <h1>Referral Partner & Commission Wallet</h1>
          <p>
            Audited referral attribution, commission approval and partner payout
            ledger.
          </p>
        </div>
        <div>
          <button onClick={load}>
            <RefreshCw /> Refresh
          </button>
          <button className="primary" onClick={() => setAdding(true)}>
            <Plus /> Add Partner
          </button>
        </div>
      </header>
      <div className="rw-compliance">
        Compliance control: enable commercial referral payments only after
        clinic legal/ethics approval. Physician referral commissions and
        patient procurement may be prohibited.
      </div>
      {error && <div className="rw-error">{error}</div>}
      <div className="rw-stats">
        {[
          ["Partners", s.partners, Users],
          ["Eligible", money(s.eligible), Clock3],
          ["Approved", money(s.approved), CheckCircle2],
          ["Wallet Liability", money(s.wallet_liability), WalletCards],
        ].map(([l, v, I]: any) => (
          <article>
            <I />
            <small>{l}</small>
            <strong>{v || 0}</strong>
          </article>
        ))}
      </div>
      <nav>
        {[
          "Partners",
          "Commission Rules",
          "Commissions",
          "Withdrawals",
          "Transactions",
        ].map((x) => (
          <button
            className={tab === x ? "active" : ""}
            onClick={() => setTab(x)}
          >
            {x}
          </button>
        ))}
      </nav>
      {tab === "Partners" ? (
        <Table
          heads={[
            "Partner",
            "Contact",
            "KYC / Bank",
            "Commission",
            "Referrals",
            "Balance",
            "Status",
            "Actions",
          ]}
          rows={partners.map((p) => [
            <>
              <b>{p.name}</b>
              <small>
                {p.partner_code} · {p.partner_type}
              </small>
            </>,
            <>
              {p.phone}
              <small>{p.email}</small>
            </>,
            <>
              {p.kyc?.status || "Pending"}
              <small>
                {p.bank_details?.upi ||
                  p.bank_details?.account_number ||
                  "Not recorded"}
              </small>
            </>,
            <div className="rw-rule-summary">
              {rules.filter(
                (rule) => rule.partner_id === p.id && rule.status === "Active",
              ).length ? (
                rules
                  .filter(
                    (rule) =>
                      rule.partner_id === p.id && rule.status === "Active",
                  )
                  .slice(0, 3)
                  .map((rule) => (
                    <small key={rule.id}>
                      {rule.service_type}:{" "}
                      {rule.commission_type === "Percentage"
                        ? `${rule.rate}%`
                        : money(rule.rate)}
                    </small>
                  ))
              ) : (
                <small>No specific rule</small>
              )}
            </div>,
            p.referrals,
            money(p.balance),
            p.status,
            <div className="rw-actions">
              <button onClick={() => setEditingPartner(p)}>
                <Pencil /> Edit
              </button>
              <button onClick={() => setCommissionPartner(p)}>
                <Percent /> Commission
              </button>
            </div>,
          ])}
        />
      ) : tab === "Commission Rules" ? (
        <>
          <button className="rw-add-rule" onClick={() => setAdding(true)}>
            + Add Commission Rule
          </button>
          <Table
            heads={[
              "Partner",
              "Service",
              "Method",
              "Rate",
              "Effective",
              "Status",
            ]}
            rows={rules.map((r) => [
              r.partner_name || "Default for all",
              r.service_type,
              r.commission_type,
              r.commission_type === "Percentage" ? `${r.rate}%` : money(r.rate),
              `${String(r.effective_from).slice(0, 10)} onward`,
              r.status,
            ])}
          />
        </>
      ) : tab === "Commissions" ? (
        <Table
          heads={[
            "Partner / Patient",
            "Invoice",
            "Service",
            "Bill",
            "Commission",
            "Status",
            "Action",
          ]}
          rows={(data.commissions || []).map((c: Row) => [
            <>
              <b>{c.partner_name}</b>
              <small>
                {c.patient_name} · {c.medical_record_number}
              </small>
            </>,
            c.invoice_number,
            c.service_type,
            money(c.bill_amount),
            money(c.commission_amount),
            c.status,
            <div className="rw-actions">
              {c.status === "Eligible" && (
                <>
                  <button
                    onClick={() =>
                      action(`/commissions/${c.id}/action`, {
                        action: "approve",
                      })
                    }
                  >
                    Approve
                  </button>
                  <button
                    onClick={() =>
                      action(`/commissions/${c.id}/action`, {
                        action: "hold",
                        reason: "Admin hold",
                      })
                    }
                  >
                    Hold
                  </button>
                </>
              )}
              {c.status === "On Hold" && (
                <button
                  onClick={() =>
                    action(`/commissions/${c.id}/action`, { action: "release" })
                  }
                >
                  Release
                </button>
              )}
            </div>,
          ])}
        />
      ) : tab === "Withdrawals" ? (
        <Table
          heads={[
            "Partner",
            "Requested",
            "Method",
            "Status",
            "Reference",
            "Action",
          ]}
          rows={(data.withdrawals || []).map((w: Row) => [
            w.partner_name,
            money(w.amount),
            w.method,
            w.status,
            w.payment_reference || "—",
            <div className="rw-actions">
              {w.status === "Requested" && (
                <button
                  onClick={() =>
                    action(`/withdrawals/${w.id}/action`, { action: "approve" })
                  }
                >
                  Approve
                </button>
              )}
              {w.status === "Approved" && (
                <button
                  onClick={() => {
                    const ref = prompt("Payment reference / UTR");
                    if (ref)
                      action(`/withdrawals/${w.id}/action`, {
                        action: "pay",
                        payment_reference: ref,
                      });
                  }}
                >
                  Mark Paid
                </button>
              )}
            </div>,
          ])}
        />
      ) : (
        <Table
          heads={[
            "Partner",
            "Type",
            "Amount",
            "Reference",
            "Description",
            "Date",
          ]}
          rows={(data.transactions || []).map((t: Row) => [
            t.partner_name,
            t.transaction_type,
            money(t.amount),
            t.reference || "—",
            t.description,
            new Date(t.created_at).toLocaleString(),
          ])}
        />
      )}{" "}
      {adding &&
        (tab === "Commission Rules" ? (
          <RuleModal
            token={token}
            partners={partners}
            close={() => setAdding(false)}
            saved={() => {
              setAdding(false);
              void load();
            }}
          />
        ) : (
          <PartnerModal
            token={token}
            close={() => setAdding(false)}
            saved={() => {
              setAdding(false);
              void load();
            }}
          />
        ))}
      {editingPartner && (
        <PartnerModal
          token={token}
          partner={editingPartner}
          close={() => setEditingPartner(null)}
          saved={() => {
            setEditingPartner(null);
            void load();
          }}
        />
      )}
      {commissionPartner && (
        <RuleModal
          token={token}
          partners={partners}
          selectedPartner={commissionPartner}
          close={() => setCommissionPartner(null)}
          saved={() => {
            setCommissionPartner(null);
            void load();
          }}
        />
      )}
    </section>
  );
}
function Table({ heads, rows }: { heads: string[]; rows: any[][] }) {
  return (
    <div className="rw-table">
      <table>
        <thead>
          <tr>
            {heads.map((h) => (
              <th>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p>No records available.</p>}
    </div>
  );
}
function PartnerModal({
  token,
  partner,
  close,
  saved,
}: {
  token: string;
  partner?: Row;
  close: () => void;
  saved: () => void;
}) {
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await call(partner ? `/partners/${partner.id}` : "/partners", token, {
        method: partner ? "PATCH" : "POST",
        body: JSON.stringify({
          name: f.get("name"),
          phone: f.get("phone"),
          password: f.get("password") || undefined,
          email: f.get("email"),
          partner_type: f.get("partner_type"),
          status: f.get("status"),
          minimum_withdrawal: f.get("minimum_withdrawal"),
          bank_details: {
            upi: f.get("upi"),
            account_name: f.get("account_name"),
            account_number: f.get("account_number"),
            ifsc: f.get("ifsc"),
          },
          kyc: {
            pan: f.get("pan"),
            aadhaar: f.get("aadhaar"),
            status: f.get("kyc_status"),
          },
        }),
      });
      saved();
    } catch (x) {
      Swal.fire(
        partner ? "Unable to update" : "Unable to create",
        x instanceof Error ? x.message : "Request failed",
        "error",
      );
    }
  }
  return (
    <Modal
      title={partner ? "Edit Referral Partner" : "Register Referral Partner"}
      close={close}
    >
      <form onSubmit={submit} className="rw-form">
        {[
          ["name", "Partner / agent name"],
          ["phone", "Login phone number"],
          ["password", "Login password"],
          ["email", "Email"],
          ["upi", "UPI ID"],
          ["account_name", "Bank account name"],
          ["account_number", "Account number"],
          ["ifsc", "IFSC"],
          ["pan", "PAN / KYC number"],
          ["aadhaar", "Aadhaar / ID reference"],
          ["minimum_withdrawal", "Minimum withdrawal"],
        ].map(([n, l]) => (
          <label>
            {l}
            <input
              name={n}
              type={
                n === "password"
                  ? "password"
                  : n === "minimum_withdrawal"
                    ? "number"
                    : "text"
              }
              defaultValue={
                n === "minimum_withdrawal"
                  ? (partner?.minimum_withdrawal ?? 500)
                  : n === "name"
                    ? partner?.name
                    : n === "phone"
                      ? partner?.phone
                      : n === "email"
                        ? partner?.email
                        : n === "upi"
                          ? partner?.bank_details?.upi
                          : n === "account_name"
                            ? partner?.bank_details?.account_name
                            : n === "account_number"
                              ? partner?.bank_details?.account_number
                              : n === "ifsc"
                                ? partner?.bank_details?.ifsc
                                : n === "pan"
                                  ? partner?.kyc?.pan
                                  : n === "aadhaar"
                                    ? partner?.kyc?.aadhaar
                                    : ""
              }
              placeholder={
                n === "password" && partner
                  ? "Leave blank to keep current password"
                  : undefined
              }
              required={
                ["name", "phone"].includes(n) || (n === "password" && !partner)
              }
            />
          </label>
        ))}
        <label>
          Partner type
          <select
            name="partner_type"
            defaultValue={partner?.partner_type ?? "Referral Partner"}
          >
            <option>Referral Partner</option>
            <option>Broker</option>
            <option>Agent</option>
            <option>Corporate Partner</option>
          </select>
        </label>
        <label>
          KYC status
          <select
            name="kyc_status"
            defaultValue={partner?.kyc?.status ?? "Pending"}
          >
            <option>Pending</option>
            <option>Verified</option>
            <option>Rejected</option>
          </select>
        </label>
        <label>
          Account status
          <select name="status" defaultValue={partner?.status ?? "Active"}>
            <option>Active</option>
            <option>Inactive</option>
            <option>Suspended</option>
          </select>
        </label>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary">
            {partner ? "Save Partner" : "Create Partner & Login"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
function RuleModal({
  token,
  partners,
  selectedPartner,
  close,
  saved,
}: {
  token: string;
  partners: Row[];
  selectedPartner?: Row;
  close: () => void;
  saved: () => void;
}) {
  const services = [
    "All",
    "OPD",
    "IPD",
    "Surgery",
    "Diagnostics",
    "Dental",
    "Health Package",
    "Pharmacy",
  ];
  const [selectedServices, setSelectedServices] = useState<string[]>(["All"]);
  function toggleService(service: string) {
    setSelectedServices((current) => {
      if (service === "All") return ["All"];
      const withoutAll = current.filter((item) => item !== "All");
      return withoutAll.includes(service)
        ? withoutAll.filter((item) => item !== service)
        : [...withoutAll, service];
    });
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    if (!selectedServices.length) {
      await Swal.fire(
        "Select a service",
        "Choose at least one service for this commission.",
        "warning",
      );
      return;
    }
    try {
      await Promise.all(
        selectedServices.map((service_type) =>
          call("/rules", token, {
            method: "POST",
            body: JSON.stringify({
              ...f,
              service_type,
              partner_id: f.partner_id || null,
              max_amount: f.max_amount || null,
            }),
          }),
        ),
      );
      saved();
    } catch (x) {
      Swal.fire(
        "Unable to create",
        x instanceof Error ? x.message : "Request failed",
        "error",
      );
    }
  }
  return (
    <Modal
      title={
        selectedPartner
          ? `Set Commission — ${selectedPartner.name}`
          : "Commission Rule"
      }
      close={close}
    >
      <form onSubmit={submit} className="rw-form">
        {selectedPartner ? (
          <input type="hidden" name="partner_id" value={selectedPartner.id} />
        ) : (
          <label>
            Partner
            <select name="partner_id">
              <option value="">Default for all partners</option>
              {partners.map((p) => (
                <option value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}
        <fieldset className="rw-service-picker">
          <legend>
            Services <span>Select one or multiple</span>
          </legend>
          <div>
            {services.map((service) => (
              <label
                key={service}
                className={selectedServices.includes(service) ? "selected" : ""}
              >
                <input
                  type="checkbox"
                  checked={selectedServices.includes(service)}
                  onChange={() => toggleService(service)}
                />
                {service}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          Commission method
          <select name="commission_type">
            <option>Percentage</option>
            <option>Fixed</option>
            <option>Custom</option>
          </select>
        </label>
        <label>
          Rate / amount
          <input name="rate" type="number" min="0" step="0.01" required />
        </label>
        <label>
          Maximum amount
          <input name="max_amount" type="number" min="0" step="0.01" />
        </label>
        <label>
          Effective from
          <input
            name="effective_from"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
          />
        </label>
        <label>
          Effective to
          <input name="effective_to" type="date" />
        </label>
        <footer>
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary">Save Rule</button>
        </footer>
      </form>
    </Modal>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: any;
}) {
  return (
    <div className="rw-back">
      <section className="rw-modal">
        <header>
          <h2>{title}</h2>
          <button onClick={close}>×</button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function BrokerDashboard({
  token,
  initialSection = "Referrals",
}: {
  token: string;
  initialSection?: string;
}) {
  const section =
    initialSection === "Wallet" ? "Wallet Transactions" : initialSection;
  const [data, setData] = useState<Row>({
      partner: {},
      summary: {},
      referrals: [],
      transactions: [],
      withdrawals: [],
    }),
    [tab, setTab] = useState(section),
    [withdrawOpen, setWithdrawOpen] = useState(false);
  const load = useCallback(
    () =>
      call("/broker-dashboard", token)
        .then(setData)
        .catch((e) =>
          Swal.fire(
            "Unable to load",
            e instanceof Error ? e.message : "Request failed",
            "error",
          ),
        ),
    [token],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => setTab(section), [section]);
  const s = data.summary || {};
  async function withdraw(amount: number, method: string, notes: string) {
    try {
      await call("/withdrawals", token, {
        method: "POST",
        body: JSON.stringify({
          amount,
          method,
          notes,
        }),
      });
      await Swal.fire(
        "Requested",
        "Withdrawal request submitted for approval.",
        "success",
      );
      setWithdrawOpen(false);
      setTab("Withdrawals");
      void load();
    } catch (e) {
      Swal.fire(
        "Unable to request",
        e instanceof Error ? e.message : "Request failed",
        "error",
      );
    }
  }
  return (
    <section className="rw-page broker-page">
      <header>
        <div>
          <small>Partner Portal · {data.partner?.partner_code}</small>
          <h1>Welcome, {data.partner?.name}</h1>
          <p>
            Track referrals, approved earnings, wallet credits and withdrawals.
          </p>
        </div>
        <button className="primary" onClick={() => setWithdrawOpen(true)}>
          Request Withdrawal
        </button>
      </header>
      <div className="rw-stats">
        {[
          ["Patients Referred", data.referrals?.length, Users],
          ["Wallet Balance", money(s.available_balance), WalletCards],
          ["Pending Commission", money(s.pending_amount), Clock3],
          ["Total Earned", money(s.total_earned), BadgeIndianRupee],
          ["Total Withdrawn", money(s.total_paid), CheckCircle2],
        ].map(([l, v, I]: any) => (
          <article>
            <I />
            <small>{l}</small>
            <strong>{v || 0}</strong>
          </article>
        ))}
      </div>
      <nav>
        {["Referrals", "Wallet Transactions", "Withdrawals", "Profile"].map(
          (x) => (
            <button
              className={tab === x ? "active" : ""}
              onClick={() => setTab(x)}
            >
              {x}
            </button>
          ),
        )}
      </nav>
      {tab === "Referrals" ? (
        <Table
          heads={[
            "Patient",
            "Bills",
            "Services",
            "Total Bill",
            "My Commission",
            "Status",
          ]}
          rows={(data.referrals || []).map((r: Row) => [
            <>
              <b>{r.patient_name}</b>
              <small>{r.medical_record_number}</small>
            </>,
            r.invoice_numbers,
            r.services,
            money(r.total_bill),
            money(r.commission_amount),
            r.status,
          ])}
        />
      ) : tab === "Wallet Transactions" ? (
        <Table
          heads={["Type", "Credit / Debit", "Reference", "Description", "Date"]}
          rows={(data.transactions || []).map((t: Row) => [
            t.transaction_type,
            money(t.amount),
            t.reference || "—",
            t.description,
            new Date(t.created_at).toLocaleString(),
          ])}
        />
      ) : tab === "Withdrawals" ? (
        <Table
          heads={[
            "Amount",
            "Method",
            "Status",
            "Payment Reference",
            "Requested",
            "Approved",
            "Paid",
            "Notes",
          ]}
          rows={(data.withdrawals || []).map((w: Row) => [
            money(w.amount),
            w.method,
            w.status,
            w.payment_reference || "—",
            new Date(w.requested_at).toLocaleString(),
            w.approved_at ? new Date(w.approved_at).toLocaleString() : "—",
            w.paid_at ? new Date(w.paid_at).toLocaleString() : "—",
            w.notes || "—",
          ])}
        />
      ) : (
        <div className="rw-profile">
          <h2>{data.partner?.name}</h2>
          <p>
            <b>Referral code:</b> {data.partner?.partner_code}
          </p>
          <p>
            <b>Phone:</b> {data.partner?.phone}
          </p>
          <p>
            <b>KYC:</b> {data.partner?.kyc?.status || "Pending"}
          </p>
          <p>
            <b>Minimum withdrawal:</b> {money(data.partner?.minimum_withdrawal)}
          </p>
        </div>
      )}
      {withdrawOpen && (
        <Modal title="Request Withdrawal" close={() => setWithdrawOpen(false)}>
          <form
            className="rw-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = Object.fromEntries(
                new FormData(event.currentTarget),
              );
              void withdraw(
                Number(form.amount),
                String(form.method),
                String(form.notes || ""),
              );
            }}
          >
            <div className="rw-withdraw-balance">
              <small>Available wallet balance</small>
              <strong>{money(s.available_balance)}</strong>
              <span>
                Minimum request: {money(data.partner?.minimum_withdrawal)}
              </span>
            </div>
            <label>
              Withdrawal amount
              <input
                name="amount"
                type="number"
                min={Number(data.partner?.minimum_withdrawal || 0)}
                max={Number(s.available_balance || 0)}
                step="0.01"
                required
              />
            </label>
            <label>
              Payment method
              <select name="method">
                <option>UPI</option>
                <option>Bank Transfer</option>
                <option>Cash</option>
              </select>
            </label>
            <label className="rw-wide">
              Notes
              <input name="notes" placeholder="Optional payout instructions" />
            </label>
            <footer>
              <button type="button" onClick={() => setWithdrawOpen(false)}>
                Cancel
              </button>
              <button className="primary">Submit Request</button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}
