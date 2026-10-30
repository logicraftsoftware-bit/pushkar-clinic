import { useEffect, useRef, useState, type FormEvent, type ElementType } from "react";
import { BarChart3, BedDouble, Bot, CalendarClock, ChevronRight, CircleDollarSign, ClipboardList, LoaderCircle, Paperclip, Pill, Send, Sparkles, UserRound, Users, WalletCards, Waves } from "lucide-react";
import "./ai-assistant.css";
import "./ai-runtime.css";

type Message = { id: number; from: "ai" | "user"; text: string };
type QuickQuestion = { title: string; hint: string; icon: ElementType; tone: string };

const quickQuestions: QuickQuestion[] = [
  { title: "Today's OPD patient count?", hint: "View today's OPD patient statistics", icon: Users, tone: "blue" },
  { title: "Total revenue this month?", hint: "See this month's total revenue", icon: CircleDollarSign, tone: "cyan" },
  { title: "Bed occupancy rate today?", hint: "Check current bed occupancy rate", icon: BedDouble, tone: "orange" },
  { title: "Top 5 departments by revenue", hint: "List of top 5 departments by revenue", icon: BarChart3, tone: "pink" },
  { title: "Pending appointments today?", hint: "View today's pending appointments", icon: CalendarClock, tone: "indigo" },
  { title: "This month's admission summary", hint: "Summary of admissions this month", icon: ClipboardList, tone: "red" },
  { title: "Pharmacy low stock items?", hint: "List of low stock items in pharmacy", icon: Pill, tone: "purple" },
  { title: "Outstanding patient dues?", hint: "Patients with pending payments", icon: WalletCards, tone: "amber" },
];
const receptionQuestions: QuickQuestion[] = [
  { title: "Today's OPD patient count?", hint: "View today's OPD patient statistics", icon: Users, tone: "blue" },
  { title: "Pending appointments today?", hint: "View today's pending appointments", icon: CalendarClock, tone: "indigo" },
  { title: "Current waiting patient count?", hint: "Review the active patient queue", icon: ClipboardList, tone: "pink" },
  { title: "Bed occupancy rate today?", hint: "Check current bed occupancy rate", icon: BedDouble, tone: "orange" },
  { title: "This month's admission summary", hint: "Summary of admissions this month", icon: ClipboardList, tone: "red" },
  { title: "How many patients registered today?", hint: "Today's registration activity", icon: UserRound, tone: "cyan" },
  { title: "Pharmacy low stock items?", hint: "List the low-stock item count", icon: Pill, tone: "purple" },
];
const roleQuestions: Record<string, QuickQuestion[]> = {
  Reception: receptionQuestions,
  Doctor: [
    { title: "How many appointments do I have today?", hint: "Review your own schedule", icon: CalendarClock, tone: "indigo" },
    { title: "How many consultations are pending?", hint: "Your pending clinical workload", icon: ClipboardList, tone: "blue" },
    { title: "Summarize my assigned clinical tasks", hint: "Your work items only", icon: Bot, tone: "purple" },
  ],
  Nurse: [
    { title: "How many care tasks are assigned to me?", hint: "Your assigned nursing workload", icon: ClipboardList, tone: "pink" },
    { title: "Which of my tasks are still pending?", hint: "Pending assigned tasks", icon: CalendarClock, tone: "orange" },
    { title: "Summarize my shift workload", hint: "Your care activity overview", icon: Bot, tone: "purple" },
  ],
  Laboratory: [
    { title: "How many lab orders are assigned to me?", hint: "Your laboratory workload", icon: ClipboardList, tone: "cyan" },
    { title: "How many samples are pending?", hint: "Pending assigned samples", icon: CalendarClock, tone: "orange" },
    { title: "How many results need verification?", hint: "Your verification queue", icon: Bot, tone: "purple" },
  ],
  Pharmacy: [
    { title: "How many prescriptions are pending?", hint: "Your dispensing queue", icon: ClipboardList, tone: "blue" },
    { title: "How many items are low in stock?", hint: "Pharmacy stock alerts", icon: Pill, tone: "purple" },
    { title: "Summarize my pharmacy tasks", hint: "Your assigned work overview", icon: Bot, tone: "cyan" },
  ],
  Patient: [
    { title: "When is my next appointment?", hint: "Your appointments only", icon: CalendarClock, tone: "blue" },
    { title: "How many prescriptions do I have?", hint: "Your medical records only", icon: ClipboardList, tone: "purple" },
    { title: "Do I have any outstanding bills?", hint: "Your own payment summary", icon: WalletCards, tone: "amber" },
    { title: "Summarize my recent hospital records", hint: "Your personal record overview", icon: UserRound, tone: "cyan" },
  ],
  "Branch Admin": [
    { title: "How many patients are registered in my branch?", hint: "Your branch only", icon: Users, tone: "blue" },
    { title: "What is my branch bed occupancy?", hint: "Branch occupancy summary", icon: BedDouble, tone: "orange" },
    { title: "How many appointments are pending today?", hint: "Branch appointment flow", icon: CalendarClock, tone: "indigo" },
    { title: "How many staff are active in my branch?", hint: "Branch staffing overview", icon: UserRound, tone: "cyan" },
  ],
  "Inventory Manager": [
    { title: "How many items are low in stock?", hint: "Current inventory alerts", icon: Pill, tone: "purple" },
    { title: "How many purchase orders are pending?", hint: "Purchasing workload", icon: ClipboardList, tone: "orange" },
    { title: "Summarize inventory status", hint: "Stock and transfer overview", icon: Bot, tone: "cyan" },
  ],
  Accountant: [
    { title: "What is total revenue this month?", hint: "Current hospital collections", icon: CircleDollarSign, tone: "cyan" },
    { title: "What are the outstanding patient dues?", hint: "Outstanding invoice summary", icon: WalletCards, tone: "amber" },
    { title: "Summarize invoices and payments", hint: "Finance workload overview", icon: BarChart3, tone: "blue" },
    { title: "How many refunds are pending?", hint: "Pending finance records", icon: ClipboardList, tone: "pink" },
  ],
  "HR Manager": [
    { title: "How many employees are active?", hint: "Hospital workforce summary", icon: Users, tone: "blue" },
    { title: "How many leave requests are pending?", hint: "Pending HR workload", icon: CalendarClock, tone: "orange" },
    { title: "Summarize attendance records", hint: "Attendance overview", icon: ClipboardList, tone: "cyan" },
    { title: "How many payroll tasks are pending?", hint: "Payroll processing status", icon: WalletCards, tone: "purple" },
  ],
  Radiologist: [
    { title: "How many imaging studies are assigned to me?", hint: "Your studies only", icon: ClipboardList, tone: "red" },
    { title: "How many reports need verification?", hint: "Your verification queue", icon: CalendarClock, tone: "orange" },
    { title: "Summarize my radiology workload", hint: "Your assigned work overview", icon: Bot, tone: "purple" },
  ],
};

const API = import.meta.env.VITE_API_URL ?? "";

export default function AiAssistant({ hospitalName = "your hospital", userName = "Hospital Admin", token, role = "Hospital Admin" }: { hospitalName?: string; userName?: string; token?: string; role?: string }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const questions = roleQuestions[role] ?? quickQuestions;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, loading]);

  async function ask(text: string) {
    const clean = text.trim();
    if (!clean || loading) return;
    const stamp = Date.now();
    const history = messages.slice(-8).map((message) => ({ role: message.from === "ai" ? "assistant" as const : "user" as const, content: message.text }));
    setMessages((current) => [...current, { id: stamp, from: "user", text: clean }]);
    setInput("");
    setLoading(true);
    try {
      if (!token) throw new Error("Your session is unavailable. Please sign in again.");
      const response = await fetch(`${API}/api/v1/ai-assistant/chat`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ message: clean, history }) });
      const data: unknown = await response.json();
      const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
      if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "HosAI could not answer right now.");
      if (typeof payload.answer !== "string" || !payload.answer.trim()) throw new Error("HosAI returned an invalid response. Please try again.");
      setMessages((current) => [...current, { id: stamp + 1, from: "ai", text: payload.answer as string }]);
    } catch (error) {
      setMessages((current) => [...current, { id: stamp + 1, from: "ai", text: error instanceof Error ? error.message : "HosAI could not answer right now." }]);
    } finally { setLoading(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); ask(input); }

  return <section className="ai-page">
    <div className="ai-breadcrumb">Home <ChevronRight /> <span>AI Assistant</span></div>
    <div className="ai-page-title"><h1>HosAI <Sparkles /></h1><p>Your intelligent hospital assistant. Get answers, insights and actionable data in seconds.</p></div>
    <div className="ai-layout">
      <section className="ai-chat-card">
        <header className="ai-welcome"><div className="ai-spark-box"><Sparkles /></div><div><strong>Hello, {userName || "Hospital Admin"}! 👋</strong><p>I'm HosAI, your AI assistant for {hospitalName}. Ask me anything about your hospital, reports, statistics or daily operations.</p></div></header>
        <div className="ai-conversation">
          {!messages.length ? <div className="ai-empty">
            <div className="ai-orbit"><span /><span /><div><Waves /></div><Sparkles /></div>
            <h2>How can I help you today?</h2>
            <p>Ask me about patients, appointments, revenue, inventory,<br /> staff, reports or any other hospital related information.</p>
          </div> : <div className="ai-messages">
            {messages.map((message) => <div className={`ai-message ${message.from}`} key={message.id}><div>{message.from === "ai" ? <Bot /> : <UserRound />}</div><p>{message.text}</p></div>)}
            {loading && <div className="ai-message ai"><div><Bot /></div><p className="ai-thinking"><LoaderCircle /> HosAI is analysing your hospital data...</p></div>}
            <div ref={endRef} />
          </div>}
        </div>
        <form className="ai-composer" onSubmit={submit}>
          <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Type your question here..." aria-label="Message HosAI" />
          <button className="ai-attach" type="button" aria-label="Attach file"><Paperclip /></button>
          <button className="ai-send" type="submit" disabled={!input.trim() || loading} aria-label="Send message">{loading ? <LoaderCircle className="ai-spin" /> : <Send />}</button>
        </form>
        <small className="ai-disclaimer">AI responses may not always be 100% accurate. Please verify important information.</small>
      </section>
      <aside className="ai-quick-card">
        <header><h2><Sparkles /> Quick questions</h2><p>Explore common queries or ask your own</p></header>
        <div className="ai-question-list">{questions.map(({ title, hint, icon: Icon, tone }) => <button key={title} onClick={() => ask(title)}><span className={`ai-question-icon ${tone}`}><Icon /></span><span><strong>{title}</strong><small>{hint}</small></span><ChevronRight /></button>)}</div>
        <button className="ai-reports"><BarChart3 /> View all reports <ChevronRight /></button>
      </aside>
    </div>
  </section>;
}
