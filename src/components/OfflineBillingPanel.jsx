import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ReceiptText, Plus, Trash2, Search } from "lucide-react";
import { Link } from "react-router-dom";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const inr = (v) => `₹${(Number(v) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const normalizeUnitType = (value) => {
  const unit = String(value || "piece").trim().toLowerCase();
  if (["kg", "gram", "litre", "ml", "piece"].includes(unit)) return unit;
  return "piece";
};

const qtyStepForUnit = (unitType) => {
  const unit = normalizeUnitType(unitType);
  if (unit === "kg" || unit === "litre") return 0.25;
  if (unit === "gram" || unit === "ml") return 50;
  return 1;
};

const normalizeQtyForProduct = (rawValue, product) => {
  const unitType = normalizeUnitType(product?.unit_type);
  const step = Number(product?.quantity_step || qtyStepForUnit(unitType)) || 1;
  const n = Number(rawValue || 0);
  if (!Number.isFinite(n) || n <= 0) return step;
  if (unitType === "piece" || step === 1) return Math.max(1, Math.round(n));
  const units = Math.round(n / step);
  const next = units * step;
  return Number(Math.max(step, next).toFixed(4));
};

function emptyLine() {
  return { product_id: "", quantity: 1, price: 0, query: "" };
}

export default function OfflineBillingPanel({ title = "Offline Billing", compact = false, showPartnerScope = false }) {
  const [products, setProducts] = useState([]);
  const [partners, setPartners] = useState([]);
  const [partnerId, setPartnerId] = useState("");
  const [memberRef, setMemberRef] = useState("");
  const [memberInfo, setMemberInfo] = useState(null);
  const [memberSearching, setMemberSearching] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [txnId, setTxnId] = useState("");
  const [lines, setLines] = useState([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    if (!showPartnerScope) return;
    api.get("/offline-billing/admin/partners")
      .then((r) => setPartners(r.data || []))
      .catch(() => setPartners([]));
  }, [showPartnerScope]);

  useEffect(() => {
    const query = showPartnerScope && partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : "";
    api.get(`/offline-billing/products${query}`)
      .then((r) => setProducts(r.data?.products || []))
      .catch((e) => toast.error(e?.response?.data?.detail || "Products load failed"));
  }, [showPartnerScope, partnerId]);

  const productMap = useMemo(() => {
    const map = {};
    for (const p of products) {
      map[p.id] = p;
    }
    return map;
  }, [products]);

  const grandTotal = useMemo(
    () => lines.reduce((sum, line) => sum + ((Number(line.price) || 0) * (Number(line.quantity) || 0)), 0),
    [lines]
  );

  const onPickProduct = (index, productId) => {
    const picked = productMap[productId];
    setLines((prev) => prev.map((line, i) => {
      if (i !== index) return line;
      const step = Number(picked?.quantity_step || qtyStepForUnit(picked?.unit_type || "piece")) || 1;
      return {
        ...line,
        product_id: productId,
        price: Number(picked?.price || 0),
        quantity: step,
        query: picked ? `${picked.name} ${picked.product_code ? `(${picked.product_code})` : ""}` : "",
      };
    }));
  };

  const onSearchProduct = (index, query) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, query } : line)));
  };

  const onChangeQty = (index, qty) => {
    setLines((prev) => prev.map((line, i) => {
      if (i !== index) return line;
      const product = productMap[line.product_id];
      return {
        ...line,
        quantity: normalizeQtyForProduct(qty, product),
      };
    }));
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (index) => setLines((prev) => prev.filter((_, i) => i !== index));

  const lookupMemberByRef = useCallback(async (rawRef, { silent = false } = {}) => {
    const ref = String(rawRef || "").trim();
    if (!ref) {
      setMemberInfo(null);
      return false;
    }

    setMemberSearching(true);
    try {
      const { data } = await api.get(`/offline-billing/member/${encodeURIComponent(ref)}`);
      setMemberInfo(data);
      const resolvedRef = String(data?.member_code || data?.id || ref).trim().toUpperCase();
      setMemberRef((prev) => {
        const current = String(prev || "").trim().toUpperCase();
        return resolvedRef && resolvedRef !== current ? resolvedRef : prev;
      });
      setCustomerName(String(data?.name || "").trim());
      setCustomerPhone(String(data?.phone || "").trim());
      if (!silent) toast.success("Member found");
      return true;
    } catch (e) {
      setMemberInfo(null);
      if (!silent) toast.error(e?.response?.data?.detail || "Member not found");
      return false;
    } finally {
      setMemberSearching(false);
    }
  }, []);

  const lookupMember = async () => {
    const ref = memberRef.trim();
    if (!ref) return toast.error("Enter a Member ID");
    await lookupMemberByRef(ref, { silent: false });
  };

  useEffect(() => {
    const ref = memberRef.trim();
    if (!ref) {
      setMemberInfo(null);
      return;
    }
    const timer = setTimeout(() => {
      lookupMemberByRef(ref, { silent: true });
    }, 350);
    return () => clearTimeout(timer);
  }, [memberRef, lookupMemberByRef]);

  const submit = async () => {
    if (!memberRef.trim()) return toast.error("Enter a Member ID");
    const validLines = lines
      .filter((line) => line.product_id)
      .map((line) => ({
        product_id: line.product_id,
        quantity: normalizeQtyForProduct(line.quantity, productMap[line.product_id]),
      }));

    if (validLines.length === 0) return toast.error("Add at least one product");
    if (paymentMode === "online" && !txnId.trim()) return toast.error("Enter a transaction ID for online payments");

    setSubmitting(true);
    try {
      const { data } = await api.post("/offline-billing/orders", {
        member_ref: memberRef.trim(),
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        payment_mode: paymentMode,
        txn_id: txnId.trim(),
        items: validLines,
      });
      setCreated(data);
      toast.success(data?.status === "paid" ? "Invoice generated" : (data?.approval_reason || "Order submitted for approval"));
      if (data?.order_id && data?.status === "paid") {
        const url = `/invoice/${data.order_id}?autoprint=1`;
        window.open(url, "_blank", "noopener,noreferrer");
        if (data?.member_whatsapp_share_url) {
          window.open(data.member_whatsapp_share_url, "_blank", "noopener,noreferrer");
        }
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Offline billing failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-border p-4 md:p-6" data-testid="offline-billing-panel">
      <div className="flex items-center gap-2 mb-4">
        <ReceiptText className="w-4 h-4 text-emerald-700" />
        <h3 className="font-display font-bold text-emerald-950 text-lg">{title}</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {showPartnerScope ? (
          <div>
            <Label>Partner Scope</Label>
            <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-white px-3 text-sm" data-testid="offline-partner-scope">
              <option value="">All products</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>{p.business_name} ({p.partner_code})</option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <Label>Member ID</Label>
          <div className="mt-1.5 flex gap-2">
            <Input value={memberRef} onChange={(e) => setMemberRef(e.target.value)} placeholder="e.g. MTH-ABC123" className="h-10" />
            <Button type="button" variant="outline" onClick={lookupMember} disabled={memberSearching} className="h-10 rounded-full" data-testid="offline-member-lookup">
              <Search className="w-4 h-4 mr-1" /> {memberSearching ? "Searching..." : "Find"}
            </Button>
          </div>
          {memberInfo ? (
            <p className="text-xs text-emerald-700 mt-1">{memberInfo.name} · {memberInfo.member_code}</p>
          ) : null}
        </div>

        <div>
          <Label>Payment Mode</Label>
          <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-white px-3 text-sm" data-testid="offline-payment-mode">
            <option value="cash">Cash</option>
            <option value="online">Online</option>
          </select>
        </div>

        <div>
          <Label>Customer Name</Label>
          <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="mt-1.5 h-10" placeholder="Customer name" />
        </div>

        <div>
          <Label>Customer Phone</Label>
          <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} className="mt-1.5 h-10" placeholder="Phone number" />
        </div>

        {paymentMode === "online" ? (
          <div className="md:col-span-2">
            <Label>Online Transaction ID</Label>
            <Input value={txnId} onChange={(e) => setTxnId(e.target.value)} className="mt-1.5 h-10 font-mono" placeholder="e.g. TXN123..." />
          </div>
        ) : null}
      </div>

      <div className="mt-4 space-y-3">
        {lines.map((line, idx) => {
          const p = productMap[line.product_id];
          const q = String(line.query || "").trim().toLowerCase();
          const visibleProducts = !q
            ? products
            : products.filter((item) => {
              const text = `${item.name || ""} ${item.product_code || ""} ${item.category || ""}`.toLowerCase();
              return text.includes(q);
            });
          const subtotal = (Number(line.price) || 0) * (Number(line.quantity) || 0);
          return (
            <div key={idx} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end rounded-lg border border-border p-3" data-testid={`offline-line-${idx}`}>
              <div className="md:col-span-6">
                <Label>Product</Label>
                <Input
                  value={line.query || ""}
                  onChange={(e) => onSearchProduct(idx, e.target.value)}
                  placeholder="Type product name / code"
                  className="mt-1.5 h-10"
                />
                <select
                  value={line.product_id}
                  onChange={(e) => onPickProduct(idx, e.target.value)}
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-white px-3 text-sm"
                >
                  <option value="">Select product</option>
                  {visibleProducts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} {item.product_code ? `· ${item.product_code}` : ""} ({item.product_type === "associate_partner" ? "Partner" : "METHO"})
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <Label>Rate</Label>
                <Input value={line.price || 0} readOnly className="mt-1.5 h-10 font-semibold" />
              </div>

              <div className="md:col-span-2">
                <Label>Qty{p?.unit_type && normalizeUnitType(p.unit_type) !== "piece" ? ` (${normalizeUnitType(p.unit_type)})` : ""}</Label>
                <Input
                  type="number"
                  min={String(Number(p?.quantity_step || qtyStepForUnit(p?.unit_type || "piece")) || 1)}
                  step={String(Number(p?.quantity_step || qtyStepForUnit(p?.unit_type || "piece")) || 1)}
                  value={line.quantity}
                  onChange={(e) => onChangeQty(idx, e.target.value)}
                  className="mt-1.5 h-10"
                />
              </div>

              <div className="md:col-span-2 flex items-end gap-2">
                <div className="text-sm font-semibold text-emerald-900 flex-1">{inr(subtotal)}</div>
                {lines.length > 1 ? (
                  <Button type="button" variant="outline" size="icon" onClick={() => removeLine(idx)} className="h-10 w-10 rounded-full" data-testid={`offline-remove-${idx}`}>
                    <Trash2 className="w-4 h-4 text-red-700" />
                  </Button>
                ) : null}
              </div>

              {p?.stock >= 0 ? (
                <div className="md:col-span-12 text-[11px] text-slate-500">Stock: {p.stock}{p?.unit_type && normalizeUnitType(p.unit_type) !== "piece" ? ` ${normalizeUnitType(p.unit_type)}` : ""}{p?.product_code ? ` · Code: ${p.product_code}` : ""}</div>
              ) : null}
            </div>
          );
        })}

        <Button type="button" variant="outline" onClick={addLine} className="rounded-full" data-testid="offline-add-line">
          <Plus className="w-4 h-4 mr-1" /> Add Product
        </Button>
      </div>

      <div className="mt-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3">
        <p className="font-display font-black text-xl text-emerald-950">Grand Total: {inr(grandTotal)}</p>
        <Button onClick={submit} disabled={submitting} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full" data-testid="offline-generate-invoice">
          {submitting ? "Generating..." : "Generate Invoice"}
        </Button>
      </div>

      {created ? (
        <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm">
          <p className="font-semibold text-emerald-900">
            {created.status === "paid" ? `Invoice ready: ${created.invoice_no}` : `Approval pending: ${created.invoice_no}`}
          </p>
          <p className="text-slate-700">
            Order: {created.order_no} · Mode: {created.payment_mode} · Status: {created.status}
          </p>
          {created.status !== "paid" ? (
            <p className="mt-1 text-xs text-slate-600">When admin approval is required, the commission reserve debit will be applied before the invoice opens.</p>
          ) : null}
          <div className="mt-2 flex gap-2">
            {created.status === "paid" ? (
              <Link to={`/invoice/${created.order_id}`} target="_blank">
                <Button size="sm" variant="outline" className="rounded-full border-emerald-700 text-emerald-900">View Invoice</Button>
              </Link>
            ) : null}
            {!compact ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLines([emptyLine()]);
                  setTxnId("");
                  setCreated(null);
                }}
                className="rounded-full"
              >
                New Billing
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
