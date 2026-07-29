import React, { useEffect, useMemo, useState } from "react";
import { ClipboardPlus, Warehouse } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { methoStoreApi, normalizeCollection, getErrorText } from "@/services/methoStore";
import api from "@/services/api";

const fmt = (value) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const getInventoryId = (row) => String(row?.catalog_item_id || row?.inventory_id || row?.id || row?.item_id || row?.sku || "").trim();

const getInventoryLabel = (row) => row?.name || row?.item_name || row?.sku || row?.catalog_item_id || row?.id || "Inventory item";

const getInventoryQty = (row) => Number(row?.quantity ?? row?.qty ?? row?.balance_quantity ?? row?.stock ?? 0) || 0;

const getInventoryPrice = (row) => Number(row?.price ?? row?.unit_price ?? row?.mrp ?? row?.rate ?? 0) || 0;

export default function MethoStoreOwnerPage() {
  const [inventory, setInventory] = useState([]);
  const [invoiceForm, setInvoiceForm] = useState({
    member_code: "",
    member_id: "",
    invoice_no: "",
    notes: "",
    catalog_item_id: "",
    quantity: 1,
    unit_price: 0,
  });
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [invoiceMemberInfo, setInvoiceMemberInfo] = useState(null);

  const inventoryRows = useMemo(() => normalizeCollection(inventory), [inventory]);
  const selectedInventoryItem = useMemo(
    () => inventoryRows.find((row) => getInventoryId(row) === String(invoiceForm.catalog_item_id).trim()),
    [inventoryRows, invoiceForm.catalog_item_id]
  );

  useEffect(() => {
    if (!selectedInventoryItem) return;
    const suggestedPrice = getInventoryPrice(selectedInventoryItem);
    if (suggestedPrice > 0) {
      setInvoiceForm((prev) => (Number(prev.unit_price) === suggestedPrice ? prev : { ...prev, unit_price: suggestedPrice }));
    }
  }, [selectedInventoryItem]);

  const load = async () => {
    setLoading(true);
    try {
      const [stock] = await Promise.all([
        methoStoreApi.ownerInventory(),
      ]);
      setInventory(stock);
    } catch (err) {
      toast.error(getErrorText(err, "Owner panel load failed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const ref = String(invoiceForm.member_id || invoiceForm.member_code || "").trim();
    if (!ref) {
      setInvoiceMemberInfo(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get(`/offline-billing/member/${encodeURIComponent(ref)}`);
        const resolvedCode = String(data?.member_code || data?.member_id || data?.code || "").trim().toUpperCase();
        const resolvedId = String(data?.member_id || data?.member_code || data?.id || "").trim().toUpperCase();
        setInvoiceMemberInfo(data || null);
        setInvoiceForm((prev) => ({
          ...prev,
          member_code: resolvedCode || prev.member_code,
          member_id: resolvedId || prev.member_id,
        }));
      } catch {
        setInvoiceMemberInfo(null);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [invoiceForm.member_id, invoiceForm.member_code]);

  const submitInvoice = async () => {
    if (!selectedInventoryItem) {
      toast.error("Select an item from allocated inventory first");
      return;
    }

    const requestedQty = Number(invoiceForm.quantity) || 1;
    const availableQty = getInventoryQty(selectedInventoryItem);
    if (availableQty > 0 && requestedQty > availableQty) {
      toast.error(`Only ${availableQty} available in inventory`);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        member_code: invoiceForm.member_code.trim(),
        member_id: invoiceForm.member_id.trim(),
        invoice_no: invoiceForm.invoice_no.trim(),
        notes: invoiceForm.notes.trim(),
        items: [
          {
            catalog_item_id: getInventoryId(selectedInventoryItem),
            quantity: requestedQty,
            unit_price: Number(invoiceForm.unit_price) || 0,
          },
        ],
      };
      const data = await methoStoreApi.ownerCreateInvoice(payload);
      toast.success(data?.message || data?.invoice_no ? `Invoice created: ${data.invoice_no || "Success"}` : "Invoice created");
      await load();
    } catch (err) {
      toast.error(getErrorText(err, "Invoice creation failed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="text-muted-foreground">Loading isolated owner panel...</div>;

  return (
    <div className="space-y-6" data-testid="metho-store-owner-page">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Owner</p>
        <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Metho Store Owner Panel</h1>
        <p className="text-sm text-muted-foreground font-body mt-1">This panel talks only to the isolated owner APIs. Legacy member dashboard and partner routes continue separately.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="space-y-6">
          <Panel icon={Warehouse} title="Allocated inventory">
            {inventoryRows.length === 0 ? (
              <p className="text-sm text-slate-500">No allocated inventory found for this owner yet.</p>
            ) : (
              <div className="space-y-3">
                {inventoryRows.map((row, index) => (
                  <div key={String(row.id || row.inventory_id || index)} className="rounded-xl border border-border bg-white p-3">
                    <p className="font-semibold text-emerald-950">{fmt(row.name || row.item_name || row.sku || row.catalog_item_id || row.id)}</p>
                    <p className="text-xs text-slate-500 mt-1">Available qty: {fmt(row.quantity || row.qty || row.balance_quantity)}</p>
                    <p className="text-xs text-slate-500">Status: {fmt(row.status || row.updated_at || row.note)}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>

        <section>
          <Panel icon={ClipboardPlus} title="Create owner invoice">
            <p className="text-sm text-slate-500 font-body">Use a valid member id or member code. Backend auto-attaches approved owner code and auto-approves only when member and owner validation both pass.</p>
            <div className="mt-4 space-y-3 rounded-2xl border border-border bg-slate-50 p-4">
              <Field label="Member code">
                <Input value={invoiceForm.member_code} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, member_code: e.target.value }))} placeholder="Optional member code" />
              </Field>
              <Field label="Member ID">
                <Input value={invoiceForm.member_id} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, member_id: e.target.value }))} placeholder="Optional member ID" />
              </Field>
              {invoiceMemberInfo ? (
                <p className="text-xs text-emerald-700">
                  Member: {invoiceMemberInfo?.name || invoiceMemberInfo?.user_name || "-"}
                  {invoiceMemberInfo?.phone ? ` · ${invoiceMemberInfo.phone}` : ""}
                  {invoiceMemberInfo?.member_code ? ` · ${invoiceMemberInfo.member_code}` : ""}
                </p>
              ) : null}
              <Field label="Invoice no">
                <Input value={invoiceForm.invoice_no} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, invoice_no: e.target.value }))} placeholder="Optional invoice number" />
              </Field>
              <Field label="Notes">
                <Input value={invoiceForm.notes} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Add any note" />
              </Field>
              <Field label="Inventory item">
                <select
                  value={invoiceForm.catalog_item_id}
                  onChange={(e) => setInvoiceForm((prev) => ({ ...prev, catalog_item_id: e.target.value }))}
                  className="h-11 w-full rounded-lg border border-input bg-white px-3 text-sm"
                >
                  <option value="">Choose inventory item</option>
                  {inventoryRows.map((row, index) => {
                    const value = getInventoryId(row) || String(index);
                    return (
                      <option key={value} value={value}>
                        {getInventoryLabel(row)} {getInventoryQty(row) > 0 ? `(qty ${getInventoryQty(row)})` : ""}
                      </option>
                    );
                  })}
                </select>
                {selectedInventoryItem && (
                  <p className="mt-1 text-xs text-slate-500">
                    Available: {getInventoryQty(selectedInventoryItem)} | Suggested price: {getInventoryPrice(selectedInventoryItem) || "-"}
                  </p>
                )}
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Quantity">
                  <Input type="number" value={invoiceForm.quantity} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, quantity: e.target.value }))} />
                </Field>
                <Field label="Unit price">
                  <Input type="number" value={invoiceForm.unit_price} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, unit_price: e.target.value }))} />
                </Field>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" disabled={submitting} onClick={submitInvoice}>{submitting ? "Submitting..." : "Create Invoice"}</Button>
              <Button variant="outline" className="rounded-full" onClick={load}>Refresh Panel</Button>
            </div>
          </Panel>

          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 font-body">
            This owner flow is isolated from legacy order approval. If this account is not an approved store owner yet, backend will reject access instead of affecting older systems.
          </div>
        </section>
      </div>
    </div>
  );
}

function Panel({ icon: Icon, title, children }) {
  return (
    <section className="rounded-2xl border border-border bg-white p-5 space-y-4">
      <div className="flex items-center gap-3 text-emerald-950">
        <div className="w-11 h-11 rounded-2xl bg-emerald-50 flex items-center justify-center"><Icon className="w-5 h-5" /></div>
        <h2 className="font-display font-black text-xl">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-sm font-semibold text-emerald-950">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}