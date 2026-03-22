// src/components/CRMAgentChat.jsx
// Floating AI chat widget for admin/official/super_admin.
// Full conversation history, structured data display, quick prompts.

import { useEffect, useRef, useState } from "react";
import { sendCRMChat } from "../api/adminApi";
import { toast } from "sonner";

const QUICK_PROMPTS = [
  { label:"🔴 Critical issues",      msg:"What are the most critical and emergency complaints right now?" },
  { label:"↩ Repeat complaints",     msg:"Show me all repeat complaints still open" },
  { label:"⏰ Stuck tasks",           msg:"Which tasks have been stuck or unstarted for more than 2 days?" },
  { label:"🏢 Multi-dept issues",    msg:"Are there any complaints requiring coordination between multiple departments?" },
  { label:"📋 Poor surveys",         msg:"Show me complaints with poor survey ratings this week" },
  { label:"🏗️ Contractor performance",msg:"How are the contractors performing?" },
  { label:"🚦 SLA breach risk",      msg:"Which complaints are at risk of breaching SLA (>30 days old)?" },
  { label:"📊 Weekly resolved",      msg:"How many complaints were resolved this week?" },
];

// ── Structured data renderer ──────────────────────────────────────

function DataTable({ data }) {
  if (!data || !Array.isArray(data) || data.length === 0) return null;
  const keys = Object.keys(data[0]).filter(k =>
    !["id","city_id","infra_node_id","workflow_instance_id"].includes(k)
  );
  const format = (v, k) => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "boolean") return v ? "✓" : "✗";
    if (k.includes("score")) return (+v).toFixed(2);
    if (k.includes("_at") && v) return new Date(v).toLocaleDateString("en-IN");
    if (k === "status") return <span className="capitalize text-sky-600 font-semibold">{String(v).replace(/_/g," ")}</span>;
    if (k === "priority") {
      const c = { emergency:"#dc2626",critical:"#ef4444",high:"#f97316",normal:"#6366f1",low:"#94a3b8" };
      return <span className="capitalize font-semibold" style={{color:c[v]||"#6366f1"}}>{v}</span>;
    }
    if (k === "is_blacklisted") return v ? <span className="text-red-500 font-bold">⚠ Blacklisted</span> : "Active";
    return String(v).length > 40 ? String(v).substring(0,40)+"…" : String(v);
  };
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            {keys.map(k => (
              <th key={k} className="px-3 py-2 text-left font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                {k.replace(/_/g," ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {data.map((row, i) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              {keys.map(k => (
                <td key={k} className="px-3 py-2.5 text-slate-700 whitespace-nowrap">
                  {format(row[k], k)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────

function Message({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-2.5 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-sky-600 flex items-center justify-center flex-shrink-0 mt-0.5">
          <span className="material-symbols-outlined text-white text-[14px]">smart_toy</span>
        </div>
      )}
      <div className={`max-w-[85%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-sky-600 text-white rounded-tr-sm"
            : "bg-white border border-slate-200 text-slate-700 rounded-tl-sm"
        }`}>
          {msg.content}
        </div>
        {msg.data && <DataTable data={msg.data} />}
        <span className="text-[10px] text-slate-400 px-1">
          {msg.time}
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────

export default function CRMAgentChat() {
  const user = JSON.parse(localStorage.getItem("auth_user") || "{}");
  if (!["official","admin","super_admin"].includes(user.role)) return null;

  const [open, setOpen]         = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: `Namaskar! I'm your PS-CRM assistant. Ask me anything — complaint status, worker performance, stuck tasks, SLA risks, or anything about ${user.jurisdiction_name || "your area"}.`,
      time: new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}),
    }
  ]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [showPrompts, setShowPrompts] = useState(true);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const send = async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput("");
    setShowPrompts(false);

    const userMsg = {
      role: "user",
      content: msg,
      time: new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const history = messages.slice(-8).map(m => ({ role: m.role==="assistant"?"assistant":"user", content: m.content }));
      const res = await sendCRMChat(msg, history);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: res.answer || "I couldn't process that request.",
        data: res.data,
        time: new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}),
      }]);
    } catch (e) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Sorry, I'm having trouble connecting. Please try again.",
        time: new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}),
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const clearChat = () => {
    setMessages([{
      role:"assistant",
      content:"Chat cleared. How can I help you?",
      time: new Date().toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}),
    }]);
    setShowPrompts(true);
  };

  const width  = expanded ? "w-[720px]" : "w-[380px]";
  const height = expanded ? "h-[650px]" : "h-[520px]";

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-sky-600 text-white shadow-2xl hover:bg-sky-700 hover:scale-105 active:scale-95 transition-all flex items-center justify-center"
          title="PS-CRM Assistant">
          <span className="material-symbols-outlined text-[26px]">smart_toy</span>
          {messages.length > 1 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
              {messages.filter(m=>m.role==="assistant").length - 1}
            </span>
          )}
        </button>
      )}

      {/* Chat window */}
      {open && (
        <div className={`fixed bottom-6 right-6 z-50 ${width} ${height} bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col transition-all duration-200`}>
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 bg-sky-600 rounded-t-2xl text-white">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-[18px]">smart_toy</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm">PS-CRM Assistant</p>
              <p className="text-[10px] text-sky-200">Gemini 2.5 Flash · {user.role}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setExpanded(e => !e)}
                className="w-7 h-7 rounded-lg hover:bg-white/20 flex items-center justify-center transition-colors"
                title={expanded?"Collapse":"Expand"}>
                <span className="material-symbols-outlined text-[16px]">{expanded?"close_fullscreen":"open_in_full"}</span>
              </button>
              <button onClick={clearChat} title="Clear chat"
                className="w-7 h-7 rounded-lg hover:bg-white/20 flex items-center justify-center transition-colors">
                <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
              </button>
              <button onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-lg hover:bg-white/20 flex items-center justify-center transition-colors">
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 bg-slate-50">
            {messages.map((m, i) => <Message key={i} msg={m} />)}

            {/* Quick prompts */}
            {showPrompts && messages.length === 1 && (
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2.5 px-1">Quick actions</p>
                <div className="grid grid-cols-2 gap-2">
                  {QUICK_PROMPTS.map((p, i) => (
                    <button key={i} onClick={() => send(p.msg)}
                      className="text-left px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-600 hover:border-sky-300 hover:text-sky-700 hover:bg-sky-50 transition-all">
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Loading indicator */}
            {loading && (
              <div className="flex gap-2.5">
                <div className="w-7 h-7 rounded-full bg-sky-600 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-white text-[14px]">smart_toy</span>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay:"0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay:"150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay:"300ms" }} />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 bg-white border-t border-slate-100 rounded-b-2xl">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                rows={1}
                placeholder="Ask about complaints, tasks, workers…"
                className="flex-1 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-sky-300 max-h-24"
                style={{ minHeight:40 }}
              />
              <button onClick={() => send()}
                disabled={!input.trim() || loading}
                className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0">
                <span className="material-symbols-outlined text-[18px]">send</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-300 mt-1.5 text-center">Enter to send · Shift+Enter for new line</p>
          </div>
        </div>
      )}
    </>
  );
}