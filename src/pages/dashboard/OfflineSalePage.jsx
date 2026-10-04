import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN")}`;
const newClientRef = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export default function OfflineSalePage() {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState({});
  const [memberRef, setMemberRef] = useState("");
  const [member, setMember] = useState(null);
  const [memberError, setMemberError] = useState("");
  const [walkIn, setWalkIn] = useState({ name: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [clientRef, setClientRef] = useState(newClientRef);

  useEffect(() => {
    api.get("/products").then((r) => setProducts(Array.isArray(r.data) ? r.data : [])).catch(() => toast.error("Could not load products"));
  }, []);

  useEffect(() => {
    const ref = memberRef.trim();
    setMember(null);
    setMemberError("");
    if (ref.length < 4) return undefined;
    const timer = window.setTimeout(() => {
      api.get("/admin/offline-sales/member", { params: { ref } })
        .then((r) => setMember(r.data))
        .catch((err) => setMemberError(err?.response?.status === 404 ? "Member not found" : "Member lookup failed"));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [memberRef]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => Number(p.stock) > 0 && (!term || `${p.name} ${p.product_code}`.toLowerCase().includes(term)));
  }, [products, search]);

  const lines = useMemo(() => products.filter((p) => cart[p.id] > 0).map((p) => ({ product: p, quantity: cart[p.id] })), [products, cart]);
  const estimate = lines.reduce((sum, l) => sum + Number(l.product.price || 0) * l.quantity, 0);

  const setQty = (product, quantity) => {
    const q = Math.max(0, Math.min(Number(product.stock) || 0, Math.floor(Number(quantity) || 0)));
    setCart((current) => ({ ...current, [product.id]: q }));
  };

  const memberPending = memberRef.trim().length >= 4 && !member && !memberError;
  const canSubmit = lines.length > 0 && !busy && !memberError && !memberPending;

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/admin/orders/offline", {
        client_ref: clientRef,
        member_code: member ? member.member_code : "",
        payer_name: member ? "" : walkIn.name,
        customer_phone: member ? "" : walkIn.phone,
        items: lines.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
      });
      setDone(data);
      toast.success(`Offline sale ${data.order_no} recorded`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not record sale");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setDone(null);
    setCart({});
    setMemberRef("");
    setWalkIn({ name: "", phone: "" });
    setClientRef(newClientRef());
    api.get("/products").then((r) => setProducts(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  };

  if (done) {
    return (
      <div className="space-y-4" data-testid="offline-sale-done">
        <h1 className="text-2xl font-bold text-emerald-950">Offline sale recorded</h1>
        <p className="text-sm text-slate-700">{done.order_no} · {money(done.total_amount)} · Cash received</p>
        <div className="flex gap-2">
          <Link to={`/invoice/${done.order_id}`} target="_blank"><Button variant="outline">Open invoice</Button></Link>
          <Button onClick={reset}>New sale</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="offline-sale-page">
      <div>
        <h1 className="text-2xl font-bold text-emerald-950">Offline Sale (Cash)</h1>
        <p className="text-sm text-slate-600">Stock, commission and invoice follow the same flow as online orders.</p>
      </div>

      <div className="rounded-xl border border-border bg-white p-4 space-y-3">
        <label className="text-xs font-semibold uppercase text-slate-500">Member ID / mobile (optional)</label>
        <Input value={memberRef} onChange={(e) => setMemberRef(e.target.value)} placeholder="e.g. MAU0001" data-testid="offline-member-ref" />
        {member ? (
          <div className="grid grid-cols-1 gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm sm:grid-cols-3" data-testid="offline-member-details">
            <div><p className="text-xs text-slate-500">Name</p><p className="font-semibold">{member.name}</p></div>
            <div><p className="text-xs text-slate-500">Mobile</p><p className="font-semibold">{member.phone || "-"}</p></div>
            <div><p className="text-xs text-slate-500">Member</p><p className="font-semibold">{member.member_code} · {member.is_active ? "Active" : "Inactive"}</p></div>
          </div>
        ) : null}
        {memberError ? <p className="text-sm text-red-600">{memberError}</p> : null}
        {!memberRef.trim() ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input value={walkIn.name} onChange={(e) => setWalkIn((c) => ({ ...c, name: e.target.value }))} placeholder="Walk-in customer name" />
            <Input value={walkIn.phone} onChange={(e) => setWalkIn((c) => ({ ...c, phone: e.target.value }))} placeholder="Mobile (optional)" />
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-border bg-white p-4 space-y-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product" />
        <div className="max-h-80 divide-y divide-border overflow-y-auto">
          {visible.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{p.name}</p>
                <p className="text-xs text-slate-500">{money(p.price)} · stock {p.stock}</p>
              </div>
              <Input type="number" min={0} max={p.stock} value={cart[p.id] || ""} onChange={(e) => setQty(p, e.target.value)} className="w-20" aria-label={`Quantity ${p.name}`} />
            </div>
          ))}
          {!visible.length ? <p className="py-3 text-sm text-slate-500">No in-stock products found.</p> : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white p-4">
        <p className="text-sm text-slate-700">{lines.length} item(s) · Estimated {money(estimate)} <span className="text-xs text-slate-500">(GST added on invoice)</span></p>
        <Button onClick={submit} disabled={!canSubmit} className="bg-emerald-800 text-white hover:bg-emerald-900" data-testid="offline-sale-submit">
          {busy ? "Saving..." : "Record cash sale"}
        </Button>
      </div>
    </div>
  );
}
