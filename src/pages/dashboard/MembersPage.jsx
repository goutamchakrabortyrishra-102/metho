import React, { useEffect, useMemo, useState } from "react";
import { Users, Search, Loader2, PowerOff, Power, Pencil, ChevronDown, Eye, Network } from "lucide-react";
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
    role: "member",
    password: "",
    is_active: true,
  });

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
      const { data } = await api.post(`/admin/users/${m.id}/toggle-active`);
      toast.success(`${data.user_name} is now ${data.active ? "active" : "blocked"}`);
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
      email: memberId,
      phone: m.phone || "",
      sponsor_code: m.sponsor_code || "",
      dob: m.dob || "",
      pan_no: m.pan_no || "",
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
        email: memberId,
        username: memberId,
        member_code: memberId,
        phone: editForm.phone,
        sponsor_code: String(editForm.sponsor_code || "").trim().toUpperCase(),
        dob: editForm.dob || null,
        pan_no: String(editForm.pan_no || "").trim().toUpperCase(),
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

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className={`grid px-5 py-3 bg-secondary/50 text-xs uppercase tracking-[0.15em] text-slate-600 font-semibold`} style={{ gridTemplateColumns: isAdmin ? "2.4fr 1.9fr 1.5fr 1.5fr 1fr 1.2fr" : "3fr 2fr 1.5fr 1.5fr 1fr" }}>
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
            <div key={m.id} className={`grid items-center px-5 py-3 hover:bg-secondary/30 transition-colors ${m.active === false ? "opacity-60 bg-red-50/40" : ""}`} style={{ gridTemplateColumns: isAdmin ? "2.4fr 1.9fr 1.5fr 1.5fr 1fr 1.2fr" : "3fr 2fr 1.5fr 1.5fr 1fr" }} data-testid={`member-row-${i}`}>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Member Full Profile</DialogTitle>
            <DialogDescription>
              ID immutable. Full details shown below.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 text-sm">
            <p><span className="font-semibold">Member ID:</span> {getMemberDisplayId(profileTarget)}</p>
            <p><span className="font-semibold">Name:</span> {profileTarget?.name}</p>
            <p><span className="font-semibold">Phone:</span> {profileTarget?.phone || "-"}</p>
            <p><span className="font-semibold">Sponsor Code:</span> {profileTarget?.sponsor_code || "-"}</p>
            <p><span className="font-semibold">DOB:</span> {profileTarget?.dob || "-"}</p>
            <p><span className="font-semibold">PAN:</span> {profileTarget?.pan_no || "-"}</p>
            <p><span className="font-semibold">Status:</span> {profileTarget?.active === false ? "inactive" : "active"}</p>
          </div>
          <DialogFooter>
            <Button onClick={() => setProfileTarget(null)} className="bg-emerald-900 hover:bg-emerald-950 text-white">Close</Button>
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
              <Label>Sponsor Code (Optional)</Label>
              <Input value={editForm.sponsor_code || ""} onChange={(e) => setEditForm({ ...editForm, sponsor_code: e.target.value.toUpperCase() })} placeholder="MAU12345" className="mt-1.5 h-11 font-mono uppercase" />
            </div>
            <div>
              <Label>DOB</Label>
              <Input type="date" value={editForm.dob || ""} onChange={(e) => setEditForm({ ...editForm, dob: e.target.value })} className="mt-1.5 h-11" />
            </div>
            <div>
              <Label>PAN Number</Label>
              <Input value={editForm.pan_no || ""} onChange={(e) => setEditForm({ ...editForm, pan_no: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" className="mt-1.5 h-11 uppercase" maxLength={10} />
            </div>
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
    </div>
  );
}

