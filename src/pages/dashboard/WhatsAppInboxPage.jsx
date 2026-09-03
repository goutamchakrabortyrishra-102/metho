import React, { useCallback, useEffect, useState } from "react";
import { MessageCircle, RefreshCw, Search, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import api from "@/services/api";

const formatTime = (value) => value ? new Date(value).toLocaleString() : "";

export default function WhatsAppInboxPage() {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const loadConversations = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/admin/crm/whatsapp/conversations", { params: { search: search || undefined } });
      const items = Array.isArray(data?.items) ? data.items : [];
      setConversations(items);
      if (selected && !items.some((item) => item.lead_id === selected.lead_id)) {
        setSelected(null);
        setMessages([]);
      }
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not load WhatsApp conversations");
    } finally {
      setLoading(false);
    }
  }, [search, selected]);

  const openConversation = async (conversation) => {
    setSelected(conversation);
    setMessages([]);
    setError("");
    try {
      const { data } = await api.get(`/admin/crm/whatsapp/conversations/${conversation.lead_id}`);
      setSelected(data?.conversation || conversation);
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not load conversation");
    }
  };

  const sendReply = async () => {
    const message = draft.trim();
    if (!selected || !message || sending) return;
    setSending(true);
    setError("");
    try {
      const { data } = await api.post(`/admin/crm/whatsapp/conversations/${selected.lead_id}/messages`, { message });
      if (data?.message) setMessages((current) => [...current, data.message]);
      setDraft("");
      await loadConversations();
    } catch (err) {
      setError(err?.response?.data?.detail || "WhatsApp reply could not be sent");
    } finally {
      setSending(false);
    }
  };

  useEffect(() => { loadConversations(); }, [loadConversations]);

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">METHO Business CRM</p><h1 className="text-2xl font-bold text-slate-900">WhatsApp Inbox</h1></div>
      <Button variant="outline" onClick={loadConversations} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>
    </div>
    {error ? <p className="text-sm text-red-600">{error}</p> : null}
    <div className="grid min-h-[600px] grid-cols-1 overflow-hidden border border-border bg-white md:grid-cols-[330px_minmax(0,1fr)]">
      <aside className="border-b border-border md:border-b-0 md:border-r">
        <div className="border-b border-border p-3"><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === "Enter" && loadConversations()} placeholder="Search contacts" className="pl-9" /></div></div>
        <div className="max-h-[500px] overflow-y-auto md:max-h-[620px]">{conversations.map((conversation) => <button key={conversation.lead_id} onClick={() => openConversation(conversation)} className={`w-full border-b border-slate-100 px-4 py-3 text-left hover:bg-emerald-50 ${selected?.lead_id === conversation.lead_id ? "bg-emerald-50" : ""}`}><div className="flex items-center justify-between gap-3"><span className="truncate font-semibold text-slate-900">{conversation.contact_person || conversation.business_name}</span><span className="shrink-0 text-[11px] text-slate-500">{formatTime(conversation.latest_message_at)}</span></div><p className="mt-0.5 text-xs text-slate-500">{conversation.phone}</p><p className="mt-1 truncate text-sm text-slate-600">{conversation.latest_message}</p></button>)}{!loading && !conversations.length ? <p className="p-5 text-sm text-slate-500">No incoming WhatsApp conversations found.</p> : null}</div>
      </aside>
      <section className="flex min-h-[500px] flex-col bg-slate-50">
        {selected ? <><header className="border-b border-border bg-white px-5 py-4"><h2 className="font-bold text-slate-900">{selected.contact_person || selected.business_name}</h2><p className="text-sm text-slate-500">{selected.phone}</p></header><div className="flex-1 space-y-3 overflow-y-auto p-5">{messages.map((message) => <div key={message.id} className={`flex ${message.direction === "outgoing" ? "justify-end" : "justify-start"}`}><div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${message.direction === "outgoing" ? "bg-emerald-700 text-white" : "bg-white text-slate-800 shadow-sm"}`}><p className="whitespace-pre-wrap">{message.text}</p><p className={`mt-1 text-[10px] ${message.direction === "outgoing" ? "text-emerald-100" : "text-slate-400"}`}>{formatTime(message.created_at)}</p></div></div>)}</div><div className="border-t border-border bg-white p-3"><div className="flex gap-2"><Input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendReply(); } }} placeholder="Write a reply" /><Button onClick={sendReply} disabled={!draft.trim() || sending}><Send className="mr-2 h-4 w-4" />Send</Button></div></div></> : <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-slate-500"><MessageCircle className="mb-3 h-9 w-9 text-emerald-700" /><p className="font-medium text-slate-700">Select a WhatsApp conversation</p><p className="mt-1 text-sm">Incoming messages stored by the existing webhook appear here.</p></div>}
      </section>
    </div>
  </div>;
}