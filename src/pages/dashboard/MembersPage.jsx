import React, { useEffect, useMemo, useState } from "react";
import { Users, Search, Loader2, PowerOff, Power, Pencil, ChevronDown, Eye, Network, MessageSquareText, Check } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { matchesSearch } from "@/lib/search";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export default function MembersPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const isAdmin = user && (user.role === "super_admin" || user.role === "company_admin" || user.role === "admin");
  const [members, setMembers] = useState([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState("members");
  const [profileTarget, setProfileTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({
    id: "",
    member_code: "",
    name: "",
    email: "",
    phone: "",
    sponsor_code: "",
    dob: "",
    pan_no: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    role: "member",
    password: "",
    is_active: true,
  });

  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [bulkWhatsAppOpen, setBulkWhatsAppOpen] = useState(false);
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkSending, setBulkSending] = useState(false);

  const toggleSelectAllFilteredMembers = () => {
    if (selectedMemberIds.length === filtered.length && filtered.length > 0) {
      setSelectedMemberIds([]);
    } else {
      setSelectedMemberIds(filtered.map((m) => m.id));
    }
  };

  const selectAllActiveMembers = () => {
    const activeIds = members.filter((m) => m.active !== false).map((m) => m.id);
    setSelectedMemberIds(activeIds);
    toast.info(`Selected all ${activeIds.length} active members`);
  };

  const toggleSelectMember = (id) => {
    setSelectedMemberIds((current) =>
      current.includes(id) ? current.filter((mId) => mId !== id) : [...current, id]
    );
  };

  const sendBulkWhatsAppForMembers = async () => {
    if (!bulkMessage.trim() || selectedMemberIds.length === 0 || bulkSending) return;
    setBulkSending(true);
    try {
      const selectedMembers = members.filter((m) => selectedMemberIds.includes(m.id));
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
      setSelectedMemberIds([]);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Bulk WhatsApp failed");
    } finally {
      setBulkSending(false);
    }
  };

  const clearTestMembers = async () => {
    if (!window.confirm("Clear all member test profiles? This will permanently remove current member accounts.")) return;
    setBusy(true);
    try {
      const { data } = await api.post("/admin/users/clear-test-members", {});
      toast.success(data?.message || "Member test profiles cleared");
      await load();
    } catch (err) {
      toast.error(adminActionError(err, "Failed to clear member profiles"));
    } finally {
      setBusy(false);
    }
  };

  const adminActionError = (err, fallback) => {
    const code = err?.response?.status;
    const detail = err?.response?.data?.detail;
    if (code === 401) {
      if (detail === "Authorization token missing" || detail === "Invalid token" || detail === "User not found") {
        return "Session expired. Please log in again as an admin.";
      }
      return "Unauthorized. Please log in again.";
    }
    if (code === 404) {
      return "Member not found. List refreshed.";
    }
    return detail || fallback;
  };

  const getMemberDisplayId = (m) => String(m?.member_code || m?.id || m?.email || "-").trim().toUpperCase();

  const load = () => {
    if (isAdmin) {
      const params = { role: "member" };
      return api.get("/admin/users", { params }).then((r) => {
        setMembers(r.data || []);
      });
    }
    return api.get("/members").then((r) => setMembers(r.data || []));
  };
  useEffect(() => { load(); }, [isAdmin, scope]);

  const scopedMembers = useMemo(() => {
    if (scope === "active") {
      return members.filter((m) => m.active !== false);
    }
    if (scope === "inactive") {
      return members.filter((m) => m.active === false);
    }
    return members;
  }, [members, scope]);

  const totalCount = members.length;
  const activeCount = useMemo(() => members.filter((m) => m.active !== false).length, [members]);
  const inactiveCount = useMemo(() => members.filter((m) => m.active === false).length, [members]);

  const filtered = useMemo(
    () =>
      scopedMembers.filter((m) =>
        matchesSearch([
          m.name,
          m.member_code,
          m.id,
          m.email,
          m.phone,
          m.pan_no,
          m.username,
          m.city,
          m.state,
          m.address,
        ], q)
      ),
    [scopedMembers, q]
  );

  const toggleActive = async (m) => {
    const action = m.active === false ? "activate" : "block";
    if (!window.confirm(`${action} ${m.name} (${m.member_code})?`)) return;
    try {
      const nextActive = m.active === false;
      await api.put(`/admin/users/${m.id}`, { active: nextActive });
      toast.success(`${m.name} is now ${nextActive ? "active" : "blocked"}`);
      load();
    } catch (err) {
      toast.error(adminActionError(err, "Failed"));
    }
  };

  const openEdit = (m) => {
    setEditTarget(m);
    const memberId = String(m.member_code || m.email || "").trim();
    setEditForm({
      id: m.id || "",
      member_code: m.member_code || "",
      name: m.name || "",
      email: m.email || memberId,
      phone: m.phone || "",
      sponsor_code: m.sponsor_code || "",
      dob: m.dob || "",
      pan_no: m.pan_no || "",
      address: m.address || "",
      city: m.city || "",
      state: m.state || "",
      pincode: m.pincode || "",
      role: m.role || "member",
      password: "",
      is_active: m.active !== false,
    });
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setBusy(true);
    try {
      const memberId = String(editTarget?.member_code || editTarget?.email || editForm.member_code || editForm.email || "").trim();
      const payload = {
        name: editForm.name,
        email: String(editForm.email || "").trim().toLowerCase(),
        username: memberId,
        member_code: memberId,
        phone: editForm.phone,
        sponsor_code: String(editForm.sponsor_code || "").trim().toUpperCase(),
        dob: editForm.dob || null,
        pan_no: String(editForm.pan_no || "").trim().toUpperCase(),
        address: editForm.address,
        city: editForm.city,
        state: editForm.state,
        pincode: editForm.pincode,
        role: "member",
        active: !!editForm.is_active,
      };
      if ((editForm.password || "").trim()) {
        payload.password = editForm.password.trim();
      }
      await api.put(`/admin/users/${editTarget.id}`, payload);
      toast.success("Member updated");
      setEditTarget(null);
      load();
    } catch (err) {
      if (err?.response?.status === 404) {
        setEditTarget(null);
        await load();
      }
      toast.error(adminActionError(err, "Update failed"));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6" data-testid="members-page">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Members</p>
        <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Member Control Box</h1>
        {isAdmin && <p className="text-sm text-muted-foreground font-body mt-1">Admin: member ID is immutable; all other profile fields are editable.</p>}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 bg-white border border-border rounded-full px-4 py-2 max-w-md w-full">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, code, username, PAN..." className="bg-transparent outline-none text-sm flex-1 font-body" data-testid="members-search-input" />
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2 flex-wrap" data-testid="member-scope-filters">
            <Button
              variant={scope === "members" ? "default" : "outline"}
              className={scope === "members" ? "rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" : "rounded-full"}
              onClick={() => { setScope("members"); setQ(""); }}
              data-testid="member-filter-all"
            >
              All ({totalCount})
            </Button>
            <Button
              variant={scope === "active" ? "default" : "outline"}
              className={scope === "active" ? "rounded-full bg-emerald-700 hover:bg-emerald-800 text-white" : "rounded-full"}
              onClick={() => { setScope("active"); setQ(""); }}
              data-testid="member-filter-active"
            >
              Active ({activeCount})
            </Button>
            <Button
              variant={scope === "inactive" ? "default" : "outline"}
              className={scope === "inactive" ? "rounded-full bg-red-700 hover:bg-red-800 text-white" : "rounded-full border-red-200 text-red-700"}
              onClick={() => { setScope("inactive"); setQ(""); }}
              data-testid="member-filter-inactive"
            >
              Inactive ({inactiveCount})
            </Button>
            <Button variant="outline" className="rounded-full border-emerald-300 text-emerald-900" onClick={selectAllActiveMembers}>
              <Users className="w-4 h-4 mr-2" /> Select All Active ({activeCount})
            </Button>
            <Button variant="outline" className="rounded-full" onClick={() => nav("/app/genealogy")}>
              <Network className="w-4 h-4 mr-2" /> View Tree
            </Button>
            <Button
              variant="outline"
              className="rounded-full border-red-200 text-red-700 hover:bg-red-50"
              onClick={clearTestMembers}
              disabled={busy}
            >
              {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Clearing...</> : "Clear Test Members"}
            </Button>
          </div>
        )}
      </div>

      {selectedMemberIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-emerald-950 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Check className="w-4 h-4 text-emerald-700" />
            Selected {selectedMemberIds.length} members
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setBulkWhatsAppOpen(true)} className="bg-emerald-800 hover:bg-emerald-900 text-white rounded-full">
              <MessageSquareText className="w-4 h-4 mr-1.5" /> Send Bulk WhatsApp ({selectedMemberIds.length})
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedMemberIds([])} className="text-slate-600 rounded-full">
              Clear selection
            </Button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className={`grid px-5 py-3 bg-secondary/50 text-xs uppercase tracking-[0.15em] text-slate-600 font-semibold`} style={{ gridTemplateColumns: isAdmin ? "0.4fr 2.4fr 1.9fr 1.5fr 1.5fr 1fr 1.2fr" : "0.4fr 3fr 2fr 1.5fr 1.5fr 1fr" }}>
          <div>
            <input
              type="checkbox"
              checked={selectedMemberIds.length === filtered.length && filtered.length > 0}
              onChange={toggleSelectAllFilteredMembers}
              className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600 cursor-pointer"
              title="Select all / Deselect all"
            />
          </div>
          <div>Member</div>
          <div>Member ID</div>
          <div>Phone</div>
          <div>PAN</div>
          <div className="text-right">Status</div>
          {isAdmin && <div className="text-right">Actions</div>}
        </div>
        <div className="divide-y divide-border">
          {filtered.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground font-body">No members found.</p>
          )}
          {filtered.map((m, i) => (
            <div key={m.id} className={`grid items-center px-5 py-3 hover:bg-secondary/30 transition-colors ${selectedMemberIds.includes(m.id) ? "bg-emerald-50/60" : ""} ${m.active === false ? "opacity-60 bg-red-50/40" : ""}`} style={{ gridTemplateColumns: isAdmin ? "0.4fr 2.4fr 1.9fr 1.5fr 1.5fr 1fr 1.2fr" : "0.4fr 3fr 2fr 1.5fr 1.5fr 1fr" }} data-testid={`member-row-${i}`}>
              <div>
                <input
                  type="checkbox"
                  checked={selectedMemberIds.includes(m.id)}
                  onChange={() => toggleSelectMember(m.id)}
                  className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600 cursor-pointer"
                />
              </div>
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-emerald-900 text-amber-400 flex items-center justify-center font-bold text-sm shrink-0">
                  {m.name?.[0]?.toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-emerald-950 text-sm truncate flex items-center gap-1.5">
                    {m.name}
                    {m.active === false && <span className="text-[9px] font-bold uppercase tracking-wider bg-red-200 text-red-800 px-1.5 py-0.5 rounded-full">Inactive</span>}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{m.role}</p>
                </div>
              </div>
              <div className="text-sm font-mono text-slate-700 truncate">{getMemberDisplayId(m)}</div>
              <div className="text-sm text-slate-700 truncate">{m.phone || "-"}</div>
              <div className="text-sm font-mono text-slate-700 truncate">{m.pan_no || "-"}</div>
              <div className="text-right text-xs text-slate-500">{m.active === false ? "inactive" : "active"}</div>
              {isAdmin && (
                <div className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" className="rounded-full text-xs" data-testid={`member-actions-${i}`}>
                        Actions <ChevronDown className="w-3 h-3 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setProfileTarget(m)}>
                        <Eye className="w-4 h-4 mr-2" /> View Profile
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openEdit(m)}>
                        <Pencil className="w-4 h-4 mr-2" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => toggleActive(m)}>
                        {m.active === false ? <Power className="w-4 h-4 mr-2" /> : <PowerOff className="w-4 h-4 mr-2" />}
                        {m.active === false ? "Activate" : "Deactive"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* View Profile Dialog */}
      <Dialog open={!!profileTarget} onOpenChange={(o) => { if (!o) setProfileTarget(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Member Full Profile</DialogTitle>
            <DialogDescription>
              ID immutable. Full details shown below.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm max-h-[65vh] overflow-y-auto pr-2">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <span className="font-semibold text-slate-700">Member ID:</span>
                <p className="font-mono text-slate-900">{getMemberDisplayId(profileTarget)}</p>
              </div>
              <div>
                <span className="font-semibold text-slate-700">Status:</span>
                <p className={`${profileTarget?.active === false ? "text-red-700 font-semibold" : "text-emerald-700 font-semibold"}`}>
                  {profileTarget?.active === false ? "INACTIVE" : "ACTIVE"}
                </p>
              </div>
              <div>
                <span className="font-semibold text-slate-700">Name:</span>
                <p className="text-slate-900">{profileTarget?.name || "-"}</p>
              </div>
              <div>
                <span className="font-semibold text-slate-700">Phone:</span>
                <p className="text-slate-900">{profileTarget?.phone || "-"}</p>
              </div>
              <div>
                <span className="font-semibold text-slate-700">Sponsor Code:</span>
                <p className="font-mono text-slate-900">{profileTarget?.sponsor_code || "-"}</p>
              </div>
              <div>
                <span className="font-semibold text-slate-700">Email:</span>
                <p className="text-slate-900">{profileTarget?.email || "-"}</p>
              </div>
              <div>
                <span className="font-semibold text-slate-700">DOB:</span>
                <p className="text-slate-900">{profileTarget?.dob || "-"}</p>
              </div>
              <div>
                <span className="font-semibold text-slate-700">PAN:</span>
                <p className="font-mono text-slate-900">{profileTarget?.pan_no || "-"}</p>
              </div>
              <div className="md:col-span-2">
                <span className="font-semibold text-slate-700">Address:</span>
                <p className="text-slate-900">{profileTarget?.address || "-"}</p>
              </div>
              <div>
                <span className="font-semibold text-slate-700">City:</span>
                <p className="text-slate-900">{profileTarget?.city || "-"}</p>
              </div>
              <div>
                <span className="font-semibold text-slate-700">State:</span>
                <p className="text-slate-900">{profileTarget?.state || "-"}</p>
              </div>
              <div>
                <span className="font-semibold text-slate-700">Pincode:</span>
                <p className="text-slate-900">{profileTarget?.pincode || "-"}</p>
              </div>
              <div>
                <span className="font-semibold text-slate-700">Purchase activation:</span>
                <p className="text-slate-900">{profileTarget?.purchase_active ? "Active" : "Not activated"}</p>
              </div>
              <div>
                <span className="font-semibold text-slate-700">Registered:</span>
                <p className="text-slate-900">{profileTarget?.created_at ? new Date(profileTarget.created_at).toLocaleString() : "-"}</p>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 flex-wrap">
            <Button onClick={() => setProfileTarget(null)} variant="outline">Close</Button>
            {isAdmin && (
              <Button onClick={() => { setProfileTarget(null); openEdit(profileTarget); }} className="bg-emerald-900 hover:bg-emerald-950 text-white">
                <Pencil className="w-4 h-4 mr-2" /> Edit Profile
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Member Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent className="max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Edit Member Profile</DialogTitle>
            <DialogDescription>
              ID cannot be changed. Admin can edit all other profile details.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 overflow-y-auto pr-1 flex-1">
            <div>
              <Label>Member ID (Not Editable)</Label>
              <Input value={editForm.member_code || editForm.email || ""} readOnly className="mt-1.5 h-11 bg-slate-50 font-mono" />
            </div>
            <div>
              <Label>Name</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="mt-1.5 h-11" />
            </div>
            <div>
              <Label>Username (Same as Member ID)</Label>
              <Input value={editForm.member_code || editForm.email || ""} readOnly className="mt-1.5 h-11 bg-slate-50 font-mono" />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className="mt-1.5 h-11" />
            </div>
            <div>
              <Label>Email (editable)</Label>
              <Input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className="mt-1.5 h-11" />
            </div>
            <div>
              <Label>Sponsor Code (Required)</Label>
              <Input required value={editForm.sponsor_code || "MAU00001"} onChange={(e) => setEditForm({ ...editForm, sponsor_code: e.target.value.toUpperCase() })} placeholder="MAU00001" className="mt-1.5 h-11 font-mono uppercase" />
            </div>
            <div>
              <Label>DOB</Label>
              <Input type="date" value={editForm.dob || ""} onChange={(e) => setEditForm({ ...editForm, dob: e.target.value })} className="mt-1.5 h-11" />
            </div>
            <div>
              <Label>PAN Number</Label>
              <Input value={editForm.pan_no || ""} onChange={(e) => setEditForm({ ...editForm, pan_no: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" className="mt-1.5 h-11 uppercase" maxLength={10} />
            </div>
            <div className="md:col-span-2"><Label>Address</Label><Input value={editForm.address || ""} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} className="mt-1.5 h-11" /></div>
            <div><Label>City</Label><Input value={editForm.city || ""} onChange={(e) => setEditForm({ ...editForm, city: e.target.value })} className="mt-1.5 h-11" /></div>
            <div><Label>State</Label><Input value={editForm.state || ""} onChange={(e) => setEditForm({ ...editForm, state: e.target.value })} className="mt-1.5 h-11" /></div>
            <div><Label>Pincode</Label><Input value={editForm.pincode || ""} onChange={(e) => setEditForm({ ...editForm, pincode: e.target.value })} className="mt-1.5 h-11" /></div>
            <div>
              <Label>Role</Label>
              <Input value="member" readOnly className="mt-1.5 h-11 bg-slate-50" />
            </div>
            <div>
              <Label>Password (optional change)</Label>
              <Input type="text" minLength={6} value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })} placeholder="leave blank to keep current" className="mt-1.5 h-11 font-mono" />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={!!editForm.is_active} onChange={(e) => setEditForm({ ...editForm, is_active: e.target.checked })} className="w-4 h-4" />
              Active / Deactive
            </label>
          </div>
          <DialogFooter className="sticky bottom-0 bg-white pt-3 mt-3 border-t border-border">
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={busy}>Cancel</Button>
            <Button onClick={saveEdit} disabled={busy} className="bg-emerald-900 hover:bg-emerald-950 text-white" data-testid="edit-member-save">
              {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkWhatsAppOpen} onOpenChange={setBulkWhatsAppOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-900">
              <MessageSquareText className="w-5 h-5 text-emerald-700" /> Send Bulk WhatsApp to Members
            </DialogTitle>
            <DialogDescription>
              Send a direct WhatsApp message to {selectedMemberIds.length} selected members.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-600">WhatsApp Message</label>
            <textarea
              value={bulkMessage}
              onChange={(e) => setBulkMessage(e.target.value)}
              placeholder="Type message to send to selected members..."
              className="w-full min-h-[120px] rounded-md border border-input p-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
            <div className="flex flex-wrap gap-1.5 text-xs text-slate-500">
              <span className="font-semibold text-slate-700">Quick templates:</span>
              <button type="button" onClick={() => setBulkMessage("Hello Member! Welcome to METHO AAY-UPAY. Check out our latest products and rewards on the portal.")} className="underline hover:text-emerald-800">Member Welcome</button>
              <span>·</span>
              <button type="button" onClick={() => setBulkMessage("Dear Member, new daily essentials and offers are now available in METHO Store! Visit https://methoaayupay.com/app/products to order.")} className="underline hover:text-emerald-800">Store Offers</button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkWhatsAppOpen(false)} disabled={bulkSending}>Cancel</Button>
            <Button onClick={sendBulkWhatsAppForMembers} disabled={!bulkMessage.trim() || bulkSending} className="bg-emerald-900 hover:bg-emerald-950 text-white">
              {bulkSending ? "Sending..." : `Send to ${selectedMemberIds.length} Members`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

