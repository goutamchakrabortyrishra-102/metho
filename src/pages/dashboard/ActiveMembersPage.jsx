import React, { useEffect, useMemo, useState } from "react";
import { Users, Search, Loader2, Check, MessageSquareText, RefreshCw, Phone } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { matchesSearch } from "@/lib/search";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export default function ActiveMembersPage() {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkWhatsAppOpen, setBulkWhatsAppOpen] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkSending, setBulkSending] = useState(false);

  const loadActiveMembers = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/users", { params: { role: "member" } });
      const items = Array.isArray(data) ? data : [];
      const activeOnly = items.filter((m) => m.active !== false);
      setMembers(activeOnly);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not load active members");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadActiveMembers();
  }, []);

  const filtered = useMemo(
    () =>
      members.filter((m) =>
        matchesSearch(
          [
            m.name,
            m.member_code,
            m.id,
            m.email,
            m.phone,
            m.pan_no,
            m.username,
            m.city,
            m.state,
          ],
          q
        )
      ),
    [members, q]
  );

  const toggleSelectAll = () => {
    if (selectedIds.length === filtered.length && filtered.length > 0) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map((m) => m.id));
    }
  };

  const selectAllActive = () => {
    setSelectedIds(members.map((m) => m.id));
    toast.info(`Selected all ${members.length} active members`);
  };

  const toggleSelectMember = (id) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((mId) => mId !== id) : [...current, id]
    );
  };

  const sendBulkWhatsApp = async () => {
    if (!bulkMessage.trim() || selectedIds.length === 0 || bulkSending) return;
    setBulkSending(true);
    try {
      const selectedMembers = members.filter((m) => selectedIds.includes(m.id));
      const recipients = selectedMembers.map((m) => m.phone).filter(Boolean);
      if (recipients.length === 0) {
        toast.error("Selected members have no phone numbers");
        return;
      }
      const { data } = await api.post("/admin/settings/whatsapp/bulk-send", {
        recipients,
        message: bulkMessage.trim(),
      });
      toast.success(`Bulk WhatsApp: ${data.sent} sent, ${data.failed} failed`);
      setBulkWhatsAppOpen(false);
      setBulkMessage("");
      setSelectedIds([]);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Bulk WhatsApp failed");
    } finally {
      setBulkSending(false);
    }
  };

  const getMemberDisplayId = (m) => String(m?.member_code || m?.id || m?.email || "-").trim().toUpperCase();

  return (
    <div className="space-y-6" data-testid="active-members-page">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">METHO Business CRM</p>
          <h1 className="font-display text-2xl font-bold text-slate-900 md:text-3xl">Active Members CRM</h1>
          <p className="mt-1 text-sm text-slate-600">Select active members and send bulk WhatsApp messages directly.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={loadActiveMembers} disabled={loading} className="rounded-full">
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button variant="outline" onClick={selectAllActive} className="rounded-full border-emerald-300 text-emerald-900">
            <Users className="mr-2 h-4 w-4" /> Select All Active ({members.length})
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex max-w-md flex-1 items-center gap-2 rounded-full border border-border bg-white px-4 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, ID, phone, PAN..."
            className="flex-1 bg-transparent text-sm outline-none font-body"
          />
        </div>

        {selectedIds.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setBulkWhatsAppOpen(true)}
              className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white"
            >
              <MessageSquareText className="mr-2 h-4 w-4" /> Send Bulk WhatsApp ({selectedIds.length})
            </Button>
            <Button variant="ghost" onClick={() => setSelectedIds([])} className="rounded-full text-slate-600">
              Clear selection
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <div className="grid bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-[0.15em] text-slate-600" style={{ gridTemplateColumns: "0.4fr 2.5fr 2fr 1.8fr 1.5fr 1fr" }}>
          <div>
            <input
              type="checkbox"
              checked={selectedIds.length === filtered.length && filtered.length > 0}
              onChange={toggleSelectAll}
              className="cursor-pointer rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
              title="Select all / Deselect all"
            />
          </div>
          <div>Member</div>
          <div>Member ID</div>
          <div>Phone / WhatsApp</div>
          <div>City / State</div>
          <div className="text-right">Status</div>
        </div>

        <div className="divide-y divide-border">
          {loading && <p className="p-6 text-center text-sm text-slate-500">Loading active members...</p>}
          {!loading && filtered.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-500">No active members found.</p>
          )}
          {!loading &&
            filtered.map((m, i) => (
              <div
                key={m.id}
                className={`grid items-center px-5 py-3 transition-colors hover:bg-slate-50/80 ${
                  selectedIds.includes(m.id) ? "bg-emerald-50/60" : ""
                }`}
                style={{ gridTemplateColumns: "0.4fr 2.5fr 2fr 1.8fr 1.5fr 1fr" }}
              >
                <div>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(m.id)}
                    onChange={() => toggleSelectMember(m.id)}
                    className="cursor-pointer rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                  />
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-900 font-bold text-amber-400 text-sm">
                    {m.name?.[0]?.toUpperCase() || "M"}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900 text-sm">{m.name}</p>
                    <p className="truncate text-xs text-slate-500">{m.email || "-"}</p>
                  </div>
                </div>
                <div className="truncate font-mono text-slate-700 text-sm">{getMemberDisplayId(m)}</div>
                <div className="flex items-center gap-1.5 truncate text-slate-700 text-sm">
                  <Phone className="h-3.5 w-3.5 text-slate-400" />
                  <span>{m.phone || "-"}</span>
                </div>
                <div className="truncate text-slate-600 text-sm">{m.city ? `${m.city}${m.state ? `, ${m.state}` : ""}` : "-"}</div>
                <div className="text-right">
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-semibold text-emerald-800 text-xs">
                    ACTIVE
                  </span>
                </div>
              </div>
            ))}
        </div>
      </div>

      <Dialog open={bulkWhatsAppOpen} onOpenChange={setBulkWhatsAppOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-900">
              <MessageSquareText className="h-5 w-5 text-emerald-700" /> Send Bulk WhatsApp to Active Members
            </DialogTitle>
            <DialogDescription>
              Sending to {selectedIds.length} selected active members. Messages will be sent directly via WhatsApp Cloud API.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-600">WhatsApp Message</label>
            <textarea
              value={bulkMessage}
              onChange={(e) => setBulkMessage(e.target.value)}
              placeholder="Type message for active members..."
              className="min-h-[120px] w-full rounded-md border border-input p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
            <div className="flex flex-wrap gap-1.5 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">Quick templates:</span>
              <button
                type="button"
                onClick={() =>
                  setBulkMessage(
                    "Hello Active Member! Check out the latest offers and updates on METHO AAY-UPAY portal."
                  )
                }
                className="underline hover:text-emerald-800"
              >
                General Announcement
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={() =>
                  setBulkMessage(
                    "Dear Member, new daily essentials and fresh produce are now in stock! Order now at https://methoaayupay.com/app/products"
                  )
                }
                className="underline hover:text-emerald-800"
              >
                Product Alert
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
              {bulkSending ? "Sending..." : `Send to ${selectedIds.length} Members`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
