// src/components/CRMAgentChat.jsx
// Floating PS-CRM agent chat widget for admin/official/super_admin

import { useState, useRef, useEffect } from "react";
import client from "../api/client";
import { toast } from "sonner";

const QUICK_PROMPTS = [
  "Show me today's critical complaints",
  "Any repeat complaints this week?",
  "Which tasks are stuck?",
  "Multi-department issues needing coordination",
  "Contractor performance summary",
  "SLA breach risks",
];

function Message({ role, content, data }) {
  const isUser = role === "user";
  return (
    <div className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-1">
          <span className="text-white text-xs font-bold">AI</span>
        </div>
      )}
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
        isUser
          ? "bg-primary text-on-primary rounded-br-sm"
          : "bg-surface-container text-on-surface rounded-bl-sm border border-outline-variant/30"
      }`}>
        {content}
        {data && data.length > 0 && (
          <div className="mt-2 pt-2 border-t border-outline-variant/20">
            <p className="text-[10px] font-semibold opacity-60 mb-1">
              {data.length} result{data.length !== 1 ? "s" : ""}
            </p>
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {data.slice(0, 5).map((item, i) => (
                <div key={i} className="text-[11px] bg-surface-container-low rounded-lg px-2 py-1 border border-outline-variant/20">
                  {item.complaint_number && (
                    <span className="font-mono text-primary mr-1">#{item.complaint_number}</span>
                  )}
                  {item.title || item.company_name || item.complaint_title || ""}
                  {item.status && (
                    <span className="ml-1 opacity-60">· {item.status}</span>
                  )}
                  {item.age_days && (
                    <span className="ml-1 text-orange-500">· {item.age_days}d old</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CRMAgentChat() {
  const [open,    setOpen]    = useState(false);
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([
    {
      role:    "assistant",
      content: "Namaskar! I'm your PS-CRM assistant. Ask me about complaints, workers, contractors, or any civic operations data.",
      data:    null,
    },
  ]);

  const bottomRef  = useRef(null);
  const inputRef   = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const history = messages.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));

  const send = async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput("");

    setMessages(prev => [...prev, { role: "user", content: msg, data: null }]);
    setLoading(true);

    try {
      const { data } = await client.post("/admin/crm/chat", { message: msg, history: history.slice(-6) });
      setMessages(prev => [...prev, {
        role:    "assistant",
        content: data.answer || "I couldn't process that request.",
        data:    data.data || null,
      }]);
    } catch {
      toast.error("CRM agent unavailable");
      setMessages(prev => [...prev, {
        role:    "assistant",
        content: "I'm having trouble connecting. Please try again.",
        data:    null,
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary text-on-primary shadow-xl flex items-center justify-center hover:scale-105 transition-transform"
        title="PS-CRM Assistant"
      >
        {open
          ? <span className="material-symbols-outlined">close</span>
          : <span className="material-symbols-outlined">smart_toy</span>
        }
        {/* Pulse indicator */}
        <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-green-500 border-2 border-white" />
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[380px] max-h-[600px] flex flex-col rounded-2xl shadow-2xl border border-outline-variant/30 bg-surface overflow-hidden"
          style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}
        >
          {/* Header */}
          <div className="bg-primary px-4 py-3 flex items-center gap-3 flex-shrink-0">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-[18px]">smart_toy</span>
            </div>
            <div>
              <p className="text-white font-semibold text-sm">PS-CRM Assistant</p>
              <p className="text-white/70 text-[10px]">Powered by Vertex AI Gemini</p>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-white/70 text-[10px]">Live</span>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 min-h-0">
            {messages.map((m, i) => (
              <Message key={i} role={m.role} content={m.content} data={m.data} />
            ))}
            {loading && (
              <div className="flex gap-2 items-center">
                <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-xs font-bold">AI</span>
                </div>
                <div className="bg-surface-container rounded-2xl rounded-bl-sm px-4 py-2.5 border border-outline-variant/30">
                  <div className="flex gap-1">
                    {[0, 0.2, 0.4].map((d, i) => (
                      <span key={i} className="w-1.5 h-1.5 rounded-full bg-primary animate-bounce"
                        style={{ animationDelay: `${d}s` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Quick prompts */}
          {messages.length <= 1 && (
            <div className="px-3 pb-2 flex gap-1.5 flex-wrap border-t border-outline-variant/20 pt-2">
              {QUICK_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="text-[10px] px-2.5 py-1 rounded-full border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 transition"
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="border-t border-outline-variant/20 p-3 flex gap-2 flex-shrink-0">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
              placeholder="Ask about complaints, workers, KPIs…"
              className="flex-1 px-3 py-2 rounded-xl border border-outline-variant bg-surface-container-low text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary"
              disabled={loading}
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              className="w-9 h-9 rounded-xl bg-primary text-on-primary flex items-center justify-center disabled:opacity-40 hover:bg-primary/90 transition flex-shrink-0"
            >
              <span className="material-symbols-outlined text-[18px]">send</span>
            </button>
          </div>
        </div>
      )}
    </>
  );
}