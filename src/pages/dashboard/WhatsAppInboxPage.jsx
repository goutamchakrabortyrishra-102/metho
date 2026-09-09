import React, { useCallback, useEffect, useState } from "react";
import { Bot, Check, CheckCheck, ImagePlus, MessageCircle, MessageSquareText, RefreshCw, Search, Send, Settings2, Trash2, X, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
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
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [error, setError] = useState("");
  const [poster, setPoster] = useState(null);
  const [posterBusy, setPosterBusy] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState([]);
  const [bulkWhatsAppOpen, setBulkWhatsAppOpen] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkSending, setBulkSending] = useState(false);

  const toggleSelectAll = () => {
    if (selectedLeadIds.length === conversations.length && conversations.length > 0) {
      setSelectedLeadIds([]);
    } else {
      setSelectedLeadIds(conversations.map((c) => c.lead_id));
    }
  };

  const toggleSelectContact = (leadId, event) => {
    event.stopPropagation();
    setSelectedLeadIds((current) =>
      current.includes(leadId) ? current.filter((id) => id !== leadId) : [...current, leadId]
    );
  };

  const sendBulkWhatsApp = async () => {
    if (!bulkMessage.trim() || selectedLeadIds.length === 0 || bulkSending) return;
    setBulkSending(true);
    try {
      const selectedContacts = conversations.filter((c) => selectedLeadIds.includes(c.lead_id));
      const recipients = selectedContacts.map((c) => c.phone).filter(Boolean);
      if (recipients.length === 0) {
        toast.error("Selected contacts have no phone numbers");
        return;
      }
      const { data } = await api.post("/admin/settings/whatsapp/bulk-send", {
        recipients,
        message: bulkMessage.trim(),
      });
      toast.success(`Bulk WhatsApp: ${data.sent} sent, ${data.failed} failed`);
      setBulkWhatsAppOpen(false);
      setBulkMessage("");
      setSelectedLeadIds([]);
      await loadConversations();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Bulk WhatsApp failed");
    } finally {
      setBulkSending(false);
    }
  };

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
      try {
        const suggestionsResponse = await api.get("/admin/crm/whatsapp-ai/suggestions", { params: { lead_id: conversation.lead_id } });
        setSuggestions(Array.isArray(suggestionsResponse.data?.items) ? suggestionsResponse.data.items : []);
      } catch {
        setSuggestions([]);
      }
    } catch (err) {
      setError(err?.response?.data?.detail || "Could not load conversation");
    }
  };

  const processSuggestion = async (suggestion, action) => {
    if (suggestionBusy) return;
    setSuggestionBusy(true);
    try {
      const { data } = await api.post(`/admin/crm/whatsapp-ai/suggestions/${suggestion.id}/${action}`, action === "approve" ? { reply: suggestion.suggested_reply } : {});
      setSuggestions((current) => current.map((item) => item.id === suggestion.id ? data.suggestion : item));
      if (action === "approve" && data.suggestion?.sent_reply) setMessages((current) => [...current, { id: `ai-${suggestion.id}`, direction: "outgoing", text: data.suggestion.sent_reply, created_at: new Date().toISOString() }]);
      toast.success(action === "approve" ? "Suggested reply sent" : "Suggestion rejected");
      await loadConversations();
    } catch (err) {
      setError(err?.response?.data?.detail || "Suggestion could not be processed");
    } finally { setSuggestionBusy(false); }
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

  const uploadPoster = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPosterBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const { data } = await api.post("/admin/settings/whatsapp/poster", body, { headers: { "Content-Type": "multipart/form-data" } });
      setPoster(data);
    } catch (err) {
      setError(err?.response?.data?.detail || "Poster upload failed");
    } finally { setPosterBusy(false); event.target.value = ""; }
  };

  const deletePoster = async () => {
    if (!poster?.url) return;
    try { await api.delete("/admin/settings/whatsapp/poster", { data: { url: poster.url } }); setPoster(null); }
    catch (err) { setError(err?.response?.data?.detail || "Poster could not be deleted"); }
  };

  const sendPoster = async () => {
    if (!selected || !poster?.url || sending) return;
    setSending(true);
    try {
      await api.post("/admin/settings/whatsapp/send-image", { recipient: selected.phone, image_url: poster.url, caption: draft.trim() });
      setPoster(null);
      setDraft("");
      await loadConversations();
      toast.success("Poster sent");
    } catch (err) { setError(err?.response?.data?.detail || "Poster could not be sent"); }
    finally { setSending(false); }
  };

  const deleteSelectedConversation = async () => {
    if (!selected || !window.confirm("Delete this WhatsApp chat? CRM lead and follow-up data will remain.")) return;
    try { await api.delete(`/admin/crm/whatsapp/conversations/${selected.lead_id}`); setSelected(null); setMessages([]); setSuggestions([]); await loadConversations(); }
    catch (err) { setError(err?.response?.data?.detail || "Chat could not be deleted"); }
  };

  const deleteAllConversations = async () => {
    if (!window.confirm("Delete all WhatsApp chat messages? CRM leads and follow-up data will remain.")) return;
    try { await api.delete("/admin/crm/whatsapp/conversations"); setSelected(null); setMessages([]); setSuggestions([]); await loadConversations(); }
    catch (err) { setError(err?.response?.data?.detail || "All chats could not be deleted"); }
  };

  const deleteAllPosters = async () => {
    if (!window.confirm("Delete all uploaded WhatsApp posters? Chat messages and CRM leads will remain.")) return;
    try {
      const { data } = await api.delete("/admin/settings/whatsapp/posters");
      toast.success(`${Number(data?.deleted || 0)} poster(s) deleted`);
    } catch (err) { setError(err?.response?.data?.detail || "Posters could not be deleted"); }
  };

  const markRead = async () => {
    if (!selected) return;
    try { await api.post(`/admin/crm/whatsapp/conversations/${selected.lead_id}/read`); toast.success("Chat marked read"); }
    catch (err) { setError(err?.response?.data?.detail || "Chat could not be marked read"); }
  };

  const markAllRead = async () => {
    try { await api.post("/admin/crm/whatsapp/conversations/read-all"); toast.success("All chats marked read"); }
    catch (err) { setError(err?.response?.data?.detail || "Chats could not be marked read"); }
  };

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => {
    if (!selected) return;
    const focusReplyBox = window.setTimeout(() => {
      document.querySelector('input[placeholder="Write a reply"]')?.focus();
    }, 0);
    return () => window.clearTimeout(focusReplyBox);
  }, [selected]);

  useEffect(() => {
    const clearSelectionOutside = (event) => {
      if (!event.target.closest("[data-whatsapp-selection]")) {
        setSelected(null);
        setMessages([]);
        setSuggestions([]);
        setDraft("");
      }
    };
    document.addEventListener("pointerdown", clearSelectionOutside);
    return () => document.removeEventListener("pointerdown", clearSelectionOutside);
  }, []);

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">METHO Business CRM</p><h1 className="text-2xl font-bold text-slate-900">WhatsApp Inbox</h1></div>
      <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to="/app/crm/whatsapp-ai"><Settings2 className="mr-2 h-4 w-4" />AI settings</Link></Button><Button variant="outline" onClick={markAllRead}><CheckCheck className="mr-2 h-4 w-4" />Mark all read</Button><Button variant="outline" onClick={deleteAllConversations}><Trash2 className="mr-2 h-4 w-4" />Delete all chats</Button><Button variant="outline" onClick={deleteAllPosters}><Trash2 className="mr-2 h-4 w-4" />Delete all posters</Button><Button variant="outline" onClick={loadConversations} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>
    </div>
    {error ? <p className="text-sm text-red-600">{error}</p> : null}

    {selectedLeadIds.length > 0 && (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-emerald-950 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Check className="h-4 w-4 text-emerald-700" />
          Selected {selectedLeadIds.length} of {conversations.length} WhatsApp contacts
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setBulkWhatsAppOpen(true)} className="bg-emerald-800 hover:bg-emerald-900 text-white rounded-full">
            <MessageSquareText className="mr-1.5 h-4 w-4" /> Send Bulk WhatsApp ({selectedLeadIds.length})
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedLeadIds([])} className="rounded-full text-slate-600">
            Clear selection
          </Button>
        </div>
      </div>
    )}

    <div className="grid min-h-[600px] grid-cols-1 overflow-hidden border border-border bg-white md:grid-cols-[330px_minmax(0,1fr)]">
      <aside className="border-b border-border md:row-span-2 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between border-b border-border p-3 gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === "Enter" && loadConversations()} placeholder="Search contacts" className="pl-9" />
          </div>
          {conversations.length > 0 && (
            <Button size="sm" variant="outline" onClick={toggleSelectAll} className="shrink-0 text-xs" title="Select all contacts for Bulk WhatsApp">
              {selectedLeadIds.length === conversations.length ? "Deselect All" : "Select All"}
            </Button>
          )}
        </div>
        <div className="max-h-[500px] overflow-y-auto md:max-h-[620px]">
          {conversations.map((conversation) => {
            const isSelected = selected?.lead_id === conversation.lead_id;
            const isChecked = selectedLeadIds.includes(conversation.lead_id);
            return (
              <div data-whatsapp-selection key={conversation.lead_id} className={`flex items-start border-b border-slate-100 px-3 py-3 hover:bg-emerald-50 ${isSelected ? "bg-emerald-50 ring-2 ring-inset ring-emerald-600" : ""}`}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => toggleSelectContact(conversation.lead_id, e)}
                  className="mt-1.5 mr-2.5 h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600 cursor-pointer shrink-0"
                  title="Select for Bulk WhatsApp"
                />
                <button
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`Select conversation with ${conversation.contact_person || conversation.business_name || conversation.phone}`}
                  onClick={() => openConversation(conversation)}
                  className="w-full text-left min-w-0"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 truncate font-semibold text-slate-900">
                      {isSelected ? <Check className="h-4 w-4 shrink-0 text-emerald-700" aria-label="Selected" /> : null}
                      <span className="truncate">{conversation.contact_person || conversation.business_name}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-500">{formatTime(conversation.latest_message_at)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{conversation.phone}</p>
                  <p className="mt-1 truncate text-sm text-slate-600">{conversation.latest_message}</p>
                </button>
              </div>
            );
          })}
          {!loading && !conversations.length ? <p className="p-5 text-sm text-slate-500">No incoming WhatsApp conversations found.</p> : null}
        </div>
      </aside>
      {selected ? <div className="border-b border-border bg-white px-5 py-3 text-xs text-slate-600 md:col-start-2 md:col-span-1"><span className="mr-3 font-semibold text-emerald-800">Stage: {selected.status || "NEW"}</span><span className="mr-3">Follow-up: {selected.follow_up_status || "Pending"}</span>{selected.next_follow_up_at ? <span className="mr-3">Next: {formatTime(selected.next_follow_up_at)}</span> : null}{selected.member_user_id || selected.partner_request_id || selected.converted_partner_id ? <span className="text-blue-700">Registration linked</span> : null}</div> : null}
      <section className="flex min-h-[500px] flex-col bg-slate-50 md:col-start-2">
        {selected ? <div className="flex justify-end gap-2 border-b border-border bg-white px-5 py-2"><Button size="sm" variant="outline" onClick={markRead}><CheckCheck className="mr-1 h-3.5 w-3.5" />Mark read</Button><Button size="sm" variant="outline" onClick={deleteSelectedConversation}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete chat</Button></div> : null}
        {selected ? <><header className="border-b border-border bg-white px-5 py-4"><h2 className="font-bold text-slate-900">{selected.contact_person || selected.business_name}</h2><p className="text-sm text-slate-500">{selected.phone}</p></header><div className="flex-1 space-y-3 overflow-y-auto p-5">{suggestions.filter((item) => item.status === "PENDING").slice(0, 1).map((suggestion) => <div key={suggestion.id} className="border border-amber-200 bg-amber-50 p-3 text-sm"><div className="flex items-center gap-2 font-semibold text-amber-900"><Bot className="h-4 w-4" />AI suggested reply</div><p className="mt-2 whitespace-pre-wrap text-slate-800">{suggestion.suggested_reply}</p>{suggestion.human_handoff_required ? <p className="mt-2 text-xs text-red-700">Human handoff required: {suggestion.handoff_reason}</p> : <div className="mt-3 flex gap-2"><Button size="sm" onClick={() => processSuggestion(suggestion, "approve")} disabled={suggestionBusy}><Check className="mr-1 h-3.5 w-3.5" />Send</Button><Button size="sm" variant="outline" onClick={() => processSuggestion(suggestion, "reject")} disabled={suggestionBusy}><X className="mr-1 h-3.5 w-3.5" />Reject</Button></div>}</div>)}{messages.map((message) => <div key={message.id} className={`flex ${message.direction === "outgoing" ? "justify-end" : "justify-start"}`}><div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${message.direction === "outgoing" ? "bg-emerald-700 text-white" : "bg-white text-slate-800 shadow-sm"}`}><p className="whitespace-pre-wrap">{message.text}</p><p className={`mt-1 text-[10px] ${message.direction === "outgoing" ? "text-emerald-100" : "text-slate-400"}`}>{formatTime(message.created_at)}</p></div></div>)}</div></> : <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-slate-500"><MessageCircle className="mb-3 h-9 w-9 text-emerald-700" /><p className="font-medium text-slate-700">Select a WhatsApp conversation</p><p className="mt-1 text-sm">Incoming messages stored by the existing webhook appear here.</p></div>}
      </section>
    </div>
    {selected ? <div data-whatsapp-selection className="fixed bottom-4 right-4 z-50 w-[min(420px,calc(100vw-2rem))] rounded-xl border-2 border-emerald-700 bg-white p-3 shadow-2xl" role="dialog" aria-label={`Reply to ${selected.contact_person || selected.business_name || selected.phone}`}><div className="mb-2 flex items-center justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-wide text-emerald-800">Reply to selected contact</p><p className="text-sm font-semibold text-slate-900">{selected.contact_person || selected.business_name}</p><p className="text-xs text-slate-500">{selected.phone}</p></div><Check className="h-5 w-5 text-emerald-700" aria-label="Contact selected" /></div><div className="flex gap-2"><Input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendReply(); } }} placeholder="Write a reply or image caption" aria-label="Reply message" /><Button onClick={sendReply} disabled={!draft.trim() || sending}><Send className="mr-2 h-4 w-4" />Send</Button></div><div className="mt-2 flex items-center gap-2"><label className="inline-flex cursor-pointer items-center rounded-md border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-800"><ImagePlus className="mr-1 h-3.5 w-3.5" />Upload image<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={uploadPoster} disabled={posterBusy} /></label>{poster ? <Button size="sm" onClick={sendPoster} disabled={sending || posterBusy}>Send Image</Button> : null}{poster ? <Button size="sm" variant="outline" onClick={deletePoster} disabled={posterBusy}>Delete</Button> : null}</div>{poster ? <img src={poster.url} alt="Poster preview" className="mt-2 h-20 w-20 rounded object-cover" /> : null}</div> : null}

    <Dialog open={bulkWhatsAppOpen} onOpenChange={setBulkWhatsAppOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-900">
            <MessageSquareText className="h-5 w-5 text-emerald-700" /> Send Bulk WhatsApp Message
          </DialogTitle>
          <DialogDescription>
            Send a direct WhatsApp message to {selectedLeadIds.length} selected WhatsApp contacts.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-slate-600">WhatsApp Message</label>
          <textarea
            value={bulkMessage}
            onChange={(e) => setBulkMessage(e.target.value)}
            placeholder="Type message to send to all selected contacts..."
            className="min-h-[120px] w-full rounded-md border border-input p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
          <div className="flex flex-wrap gap-1.5 text-xs text-slate-500">
            <span className="font-semibold text-slate-700">Quick templates:</span>
            <button
              type="button"
              onClick={() =>
                setBulkMessage(
                  "Hello! We have an update regarding your METHO enquiry. Reply here or call us for details."
                )
              }
              className="underline hover:text-emerald-800"
            >
              General Enquiry
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() =>
                setBulkMessage(
                  "Hello! Your METHO registration process is waiting for the next step. Reply here if you need assistance."
                )
              }
              className="underline hover:text-emerald-800"
            >
              Registration Follow-up
            </button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setBulkWhatsAppOpen(false)} disabled={bulkSending}>
            Cancel
          </Button>
          <Button
            onClick={sendBulkWhatsApp}
            disabled={!bulkMessage.trim() || bulkSending}
            className="bg-emerald-900 hover:bg-emerald-950 text-white"
          >
            {bulkSending ? "Sending..." : `Send to ${selectedLeadIds.length} Contacts`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}