import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, CheckCircle2, Package, Pencil, Receipt, Store, Trash2, Warehouse, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { methoStoreApi, normalizeCollection, getErrorText, ownerLabel } from "@/services/methoStore";
import api from "@/services/api";

const EMPTY_OWNER_FORM = {
  owner_name: "",
  store_name: "",
  phone: "",
  whatsapp_no: "",
  email: "",
  password: "",
  commission_percent: 0,
  address: "",
  pincode: "",
  google_map_url: "",
  city: "",
  state: "",
};

const EMPTY_CATALOG_FORM = {
  name: "",
  sku: "",
  mrp: 0,
  price: 0,
  bv: 0,
  stock: 0,
  source_product_id: "",
};

const EMPTY_ALLOCATION_FORM = {
  catalog_item_id: "",
  quantity: 1,
  note: "Initial allocation",
};

const fmt = (value) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export default function MethoStoreAdminPage() {
  const [owners, setOwners] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [settings, setSettings] = useState({});
  const [selectedOwnerId, setSelectedOwnerId] = useState("");
  const [selectedCommission, setSelectedCommission] = useState("");
  const [ownerForm, setOwnerForm] = useState(EMPTY_OWNER_FORM);
  const [catalogForm, setCatalogForm] = useState(EMPTY_CATALOG_FORM);
  const [allocationForm, setAllocationForm] = useState(EMPTY_ALLOCATION_FORM);
  const [inventoryRows, setInventoryRows] = useState([]);
  const [ownerEditForm, setOwnerEditForm] = useState(null);
  const [invoiceForm, setInvoiceForm] = useState({ invoice_no: "", notes: "", catalog_item_id: "", quantity: 1, unit_price: "", payment_method: "cash", payment_reference: "" });
  const [ownerInvoices, setOwnerInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const ownerOptions = useMemo(() => normalizeCollection(owners), [owners]);
  const catalogRows = useMemo(() => normalizeCollection(catalog), [catalog]);
  const methoCatalogRows = useMemo(
    () => catalogRows.filter((item) => String(item.product_type || "metho").toLowerCase() === "metho"),
    [catalogRows]
  );
  const selectedCatalogItem = useMemo(
    () => methoCatalogRows.find((item) => String(item.id || item.catalog_item_id || item.sku || "").trim() === String(invoiceForm.catalog_item_id || "").trim()),
    [methoCatalogRows, invoiceForm.catalog_item_id]
  );
  const purchaseQuantity = Math.max(1, Number(invoiceForm.quantity) || 1);
  const purchaseUnitPrice = Number(invoiceForm.unit_price === "" ? (selectedCatalogItem?.price ?? 0) : invoiceForm.unit_price) || 0;
  const purchaseGrossAmount = Math.max(0, round2(purchaseQuantity * purchaseUnitPrice));
  const purchaseCommissionPercent = clampPercent(Number(selectedCommission) || 0);
  const purchaseCommissionAmount = round2((purchaseGrossAmount * purchaseCommissionPercent) / 100);
  const purchasePayableAmount = Math.max(0, round2(purchaseGrossAmount - purchaseCommissionAmount));
  const upiId = String(settings?.upi_id || "").trim();
  const upiUri = useMemo(() => {
    if (!upiId || purchasePayableAmount <= 0 || !selectedOwnerId) return "";
    const ownerCode = String(ownerOptions.find((item) => String(item.id || item.owner_id || "") === String(selectedOwnerId))?.owner_code || "").trim();
    const note = `Owner stock purchase ${ownerCode || selectedOwnerId}`;
    return `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent("METHO STORE")}&am=${encodeURIComponent(purchasePayableAmount.toFixed(2))}&cu=INR&tn=${encodeURIComponent(note)}`;
  }, [upiId, purchasePayableAmount, selectedOwnerId, ownerOptions]);
  const upiQrUrl = upiUri ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(upiUri)}` : "";

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ownersData, catalogData] = await Promise.all([
        methoStoreApi.adminListOwners(),
        methoStoreApi.adminListCatalogItems(),
      ]);
      setOwners(ownersData);
      setCatalog(catalogData);
      const firstOwner = normalizeCollection(ownersData)[0];
      if (firstOwner) {
        setSelectedOwnerId((prev) => prev || String(firstOwner.id || firstOwner.owner_id || ""));
        setSelectedCommission((prev) => prev || String(firstOwner.commission_percent ?? firstOwner.commission ?? ""));
      }
    } catch (err) {
      toast.error(getErrorText(err, "Metho Store admin data load failed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    api.get("/settings").then((r) => setSettings(r.data || {})).catch(() => setSettings({}));
  }, []);

  useEffect(() => {
    const owner = ownerOptions.find((item) => String(item.id || item.owner_id || "") === String(selectedOwnerId));
    if (owner) {
      setSelectedCommission(String(owner.commission_percent ?? owner.commission ?? ""));
    }
  }, [selectedOwnerId, ownerOptions]);

  const loadInventory = async (ownerId = selectedOwnerId) => {
    if (!ownerId) return;
    try {
      const data = await methoStoreApi.adminOwnerInventory(ownerId);
      setInventoryRows(normalizeCollection(data));
    } catch (err) {
      toast.error(getErrorText(err, "Owner inventory load failed"));
    }
  };

  const loadOwnerInvoices = async (ownerId = selectedOwnerId) => {
    if (!ownerId) return;
    try {
      const data = await methoStoreApi.adminListOwnerInvoices(ownerId);
      setOwnerInvoices(normalizeCollection(data));
    } catch (err) {
      setOwnerInvoices([]);
      toast.error(getErrorText(err, "Owner invoices load failed"));
    }
  };

  const withBusy = async (action) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const createOwner = async () => {
    await withBusy(async () => {
      const data = await methoStoreApi.adminCreateOwner({
        owner_name: ownerForm.owner_name.trim(),
        store_name: ownerForm.store_name.trim(),
        phone: ownerForm.phone.trim(),
        whatsapp_no: ownerForm.whatsapp_no.trim(),
        email: ownerForm.email.trim(),
        password: ownerForm.password,
        commission_percent: Number(ownerForm.commission_percent) || 0,
        address: ownerForm.address.trim(),
        pincode: ownerForm.pincode.trim(),
        google_map_url: ownerForm.google_map_url.trim(),
        city: ownerForm.city.trim(),
        state: ownerForm.state.trim(),
      });
      toast.success(data?.message || "Store owner created");
      setOwnerForm(EMPTY_OWNER_FORM);
      await loadAll();
    });
  };

  const approveOwner = async (ownerId) => {
    await withBusy(async () => {
      const data = await methoStoreApi.adminApproveOwner(ownerId, {});
      toast.success(data?.message || "Owner approved");
      await loadAll();
    });
  };

  const saveOwnerEdit = async () => {
    if (!ownerEditForm?.id) return;
    await withBusy(async () => {
      const payload = {
        owner_name: ownerEditForm.owner_name?.trim(),
        store_name: ownerEditForm.store_name?.trim(),
        phone: ownerEditForm.phone?.trim(),
        whatsapp_no: ownerEditForm.whatsapp_no?.trim(),
        email: ownerEditForm.email?.trim(),
        address: ownerEditForm.address?.trim(),
        pincode: ownerEditForm.pincode?.trim(),
        google_map_url: ownerEditForm.google_map_url?.trim(),
        city: ownerEditForm.city?.trim(),
        state: ownerEditForm.state?.trim(),
        commission_percent: Number(ownerEditForm.commission_percent) || 0,
      };
      const nextPassword = String(ownerEditForm.password || "").trim();
      if (nextPassword) {
        payload.password = nextPassword;
        payload.login_password = nextPassword;
      }
      const data = await methoStoreApi.adminUpdateOwner(ownerEditForm.id, payload);
      toast.success(data?.message || "Owner updated");
      setOwnerEditForm(null);
      await loadAll();
    });
  };

  const toggleOwnerActive = async (owner) => {
    const ownerId = String(owner?.id || owner?.owner_id || "");
    if (!ownerId) return;
    const current = Boolean(owner?.is_active ?? owner?.active ?? owner?.approved);
    await withBusy(async () => {
      const data = await methoStoreApi.adminSetOwnerActive(ownerId, !current);
      toast.success(data?.message || (!current ? "Owner activated" : "Owner deactivated"));
      await loadAll();
    });
  };

  const removeOwner = async (owner) => {
    const ownerId = String(owner?.id || owner?.owner_id || "");
    if (!ownerId) return;
    if (!window.confirm(`Delete owner ${ownerLabel(owner)}?`)) return;
    await withBusy(async () => {
      const data = await methoStoreApi.adminDeleteOwner(ownerId);
      toast.success(data?.message || "Owner deleted");
      if (String(selectedOwnerId) === ownerId) {
        setSelectedOwnerId("");
        setInventoryRows([]);
        setOwnerInvoices([]);
      }
      await loadAll();
    });
  };

  const resetOwnerPassword = async (owner) => {
    const ownerId = String(owner?.id || owner?.owner_id || "");
    if (!ownerId) return;
    const nextPassword = window.prompt(`New password for ${ownerLabel(owner)}:`, "");
    if (nextPassword === null) return;
    const trimmed = String(nextPassword).trim();
    if (trimmed.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    await withBusy(async () => {
      const data = await methoStoreApi.adminResetOwnerPassword(ownerId, trimmed);
      const newPassword = data?.new_password || data?.password || trimmed;
      window.prompt(`New password for ${data?.user_email || ownerLabel(owner)} (copy now — shown once):`, newPassword);
      toast.success(data?.message || "Password updated");
    });
  };

  const createOwnerInvoice = async () => {
    if (!selectedOwnerId) return toast.error("Select an owner first");
    if (!String(invoiceForm.catalog_item_id || "").trim()) return toast.error("Choose a store product first");
    if (invoiceForm.payment_method === "razorpay" && !String(invoiceForm.payment_reference || "").trim()) {
      return toast.error("After payment scan, enter Razorpay payment reference");
    }
    await withBusy(async () => {
      const payload = {
        invoice_no: String(invoiceForm.invoice_no || "").trim(),
        notes: String(invoiceForm.notes || "").trim(),
        catalog_item_id: String(invoiceForm.catalog_item_id || "").trim(),
        quantity: purchaseQuantity,
        unit_price: purchaseUnitPrice,
        payment_method: String(invoiceForm.payment_method || "cash").trim().toLowerCase(),
        payment_reference: String(invoiceForm.payment_reference || "").trim(),
        commission_percent: purchaseCommissionPercent,
      };
      const data = await methoStoreApi.adminCreateOwnerStockPurchase(selectedOwnerId, payload);
      toast.success(data?.message || data?.invoice_no ? `Invoice created: ${data.invoice_no || "Success"}` : "Invoice created");
      setInvoiceForm({ invoice_no: "", notes: "", catalog_item_id: "", quantity: 1, unit_price: "", payment_method: "cash", payment_reference: "" });
      await loadOwnerInvoices(selectedOwnerId);
      await loadInventory(selectedOwnerId);
      await loadAll();
    });
  };

  const updateCommission = async () => {
    if (!selectedOwnerId) return toast.error("Select an owner first");
    await withBusy(async () => {
      const data = await methoStoreApi.adminUpdateOwnerCommission(selectedOwnerId, {
        commission_percent: Number(selectedCommission),
      });
      toast.success(data?.message || "Commission updated");
      await loadAll();
    });
  };

  const createCatalogItem = async () => {
    await withBusy(async () => {
      const data = await methoStoreApi.adminCreateCatalogItem({
        name: catalogForm.name.trim(),
        sku: catalogForm.sku.trim(),
        mrp: Number(catalogForm.mrp) || 0,
        price: Number(catalogForm.price) || 0,
        bv: Number(catalogForm.bv) || 0,
        stock: Number(catalogForm.stock) || 0,
        source_product_id: catalogForm.source_product_id.trim(),
      });
      toast.success(data?.message || "Catalog item created");
      setCatalogForm(EMPTY_CATALOG_FORM);
      await loadAll();
    });
  };

  const allocateInventory = async () => {
    if (!selectedOwnerId) return toast.error("Select an owner first");
    await withBusy(async () => {
      const data = await methoStoreApi.adminAllocateInventory(selectedOwnerId, {
        catalog_item_id: allocationForm.catalog_item_id.trim(),
        quantity: Number(allocationForm.quantity) || 1,
        note: allocationForm.note.trim(),
      });
      toast.success(data?.message || "Inventory allocated");
      setAllocationForm(EMPTY_ALLOCATION_FORM);
      await loadInventory(selectedOwnerId);
    });
  };

  if (loading) return <div className="text-muted-foreground">Loading isolated Metho Store admin module...</div>;

  return (
    <div className="space-y-6" data-testid="metho-store-admin-page">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin</p>
        <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Metho Store Owner Control</h1>
        <p className="text-sm text-muted-foreground font-body mt-1">This panel calls only the isolated `/api/metho-store/...` endpoints. Legacy partner, checkout, and member flows remain separate.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-6">
          <Panel icon={Store} title="Owners" subtitle="Create, approve, and tune store owners without touching partner applications.">
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-slate-50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-display font-bold text-emerald-950">Current owners</p>
                  <Button variant="outline" size="sm" className="rounded-full" onClick={loadAll}>Refresh</Button>
                </div>
                {selectedOwnerId ? (
                  <p className="text-xs text-emerald-800">Selected owner ID: <span className="font-mono">{selectedOwnerId}</span></p>
                ) : null}
                <div className="space-y-3 max-h-[24rem] overflow-y-auto">
                  {ownerOptions.length === 0 && <p className="text-sm text-slate-500">No owners yet.</p>}
                  {ownerOptions.map((owner) => {
                    const ownerId = String(owner.id || owner.owner_id || "");
                    const approved = owner.is_active ?? owner.active ?? owner.approved;
                    return (
                      <div key={ownerId} className="rounded-xl border border-border bg-white p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-emerald-950">{ownerLabel(owner)}</p>
                            <p className="text-xs text-slate-500 mt-1">Code: {fmt(owner.owner_code || owner.code)}</p>
                            <p className="text-xs text-slate-500">Phone: {fmt(owner.phone)}</p>
                            <p className="text-xs text-slate-500">WhatsApp: {fmt(owner.whatsapp_no || owner.phone)}</p>
                          </div>
                          <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded-full font-bold ${approved ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{approved ? "Active" : "Pending"}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {!approved && <Button size="sm" className="rounded-full bg-emerald-700 hover:bg-emerald-800 text-white" disabled={busy} onClick={() => approveOwner(ownerId)}><CheckCircle2 className="w-3.5 h-3.5 mr-1" />Approve</Button>}
                          <Button size="sm" variant="outline" className="rounded-full" onClick={() => { setSelectedOwnerId(ownerId); loadInventory(ownerId); }}>Inventory</Button>
                          <Button size="sm" variant="outline" className="rounded-full" onClick={() => { setSelectedOwnerId(ownerId); loadOwnerInvoices(ownerId); }}>Invoices</Button>
                          <Button size="sm" variant="outline" className="rounded-full" onClick={() => setOwnerEditForm({
                            id: ownerId,
                            owner_name: owner.owner_name || owner.name || "",
                            store_name: owner.store_name || owner.business_name || "",
                            phone: owner.phone || "",
                            whatsapp_no: owner.whatsapp_no || owner.phone || "",
                            email: owner.email || "",
                            password: "",
                            address: owner.address || "",
                            pincode: owner.pincode || "",
                            google_map_url: owner.google_map_url || owner.map_url || "",
                            city: owner.city || "",
                            state: owner.state || "",
                            commission_percent: owner.commission_percent ?? owner.commission ?? 0,
                          })}><Pencil className="w-3.5 h-3.5 mr-1" />Edit</Button>
                          <Button size="sm" variant="outline" className="rounded-full" onClick={() => toggleOwnerActive(owner)}>{approved ? "Deactivate" : "Activate"}</Button>
                          <Button size="sm" variant="outline" className="rounded-full" onClick={() => resetOwnerPassword(owner)}><KeyRound className="w-3.5 h-3.5 mr-1" />Password</Button>
                          <Button size="sm" variant="outline" className="rounded-full border-red-200 text-red-700 hover:bg-red-50" onClick={() => removeOwner(owner)}><Trash2 className="w-3.5 h-3.5 mr-1" />Delete</Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-border bg-slate-50 p-4">
                <p className="font-display font-bold text-emerald-950">Create owner</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Owner name">
                    <Input value={ownerForm.owner_name} onChange={(e) => setOwnerForm((prev) => ({ ...prev, owner_name: e.target.value }))} placeholder="Enter owner name" />
                  </Field>
                  <Field label="Store name">
                    <Input value={ownerForm.store_name} onChange={(e) => setOwnerForm((prev) => ({ ...prev, store_name: e.target.value }))} placeholder="Enter store name" />
                  </Field>
                  <Field label="Phone">
                    <Input value={ownerForm.phone} onChange={(e) => setOwnerForm((prev) => ({ ...prev, phone: e.target.value }))} placeholder="Phone number" />
                  </Field>
                  <Field label="WhatsApp no">
                    <Input value={ownerForm.whatsapp_no} onChange={(e) => setOwnerForm((prev) => ({ ...prev, whatsapp_no: e.target.value }))} placeholder="WhatsApp number" />
                  </Field>
                  <Field label="Email">
                    <Input value={ownerForm.email} onChange={(e) => setOwnerForm((prev) => ({ ...prev, email: e.target.value }))} placeholder="Email address" />
                  </Field>
                  <Field label="Password">
                    <Input type="password" value={ownerForm.password} onChange={(e) => setOwnerForm((prev) => ({ ...prev, password: e.target.value }))} placeholder="Set password" />
                  </Field>
                  <Field label="Pincode">
                    <Input value={ownerForm.pincode} onChange={(e) => setOwnerForm((prev) => ({ ...prev, pincode: e.target.value }))} placeholder="Pincode" />
                  </Field>
                  <Field label="Commission %">
                    <Input type="number" value={ownerForm.commission_percent} onChange={(e) => setOwnerForm((prev) => ({ ...prev, commission_percent: e.target.value }))} />
                  </Field>
                  <Field label="City">
                    <Input value={ownerForm.city} onChange={(e) => setOwnerForm((prev) => ({ ...prev, city: e.target.value }))} placeholder="City" />
                  </Field>
                  <Field label="State">
                    <Input value={ownerForm.state} onChange={(e) => setOwnerForm((prev) => ({ ...prev, state: e.target.value }))} placeholder="State" />
                  </Field>
                  <Field label="Address" className="md:col-span-2">
                    <Input value={ownerForm.address} onChange={(e) => setOwnerForm((prev) => ({ ...prev, address: e.target.value }))} placeholder="Full address" />
                  </Field>
                  <Field label="Google Map URL" className="md:col-span-2">
                    <Input value={ownerForm.google_map_url} onChange={(e) => setOwnerForm((prev) => ({ ...prev, google_map_url: e.target.value }))} placeholder="https://maps.google.com/..." />
                  </Field>
                </div>
                <Button className="w-full rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" disabled={busy} onClick={createOwner}>Create Owner</Button>
              </div>
            </div>
          </Panel>

          <Panel icon={Package} title="Catalog" subtitle="Maintain separate Metho Store Owner catalog and stock linkage.">
            <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-3 rounded-2xl border border-border bg-slate-50 p-4">
                <p className="font-display font-bold text-emerald-950">Create catalog item</p>
                <Field label="Item name">
                  <Input value={catalogForm.name} onChange={(e) => setCatalogForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Product name" />
                </Field>
                <Field label="SKU">
                  <Input value={catalogForm.sku} onChange={(e) => setCatalogForm((prev) => ({ ...prev, sku: e.target.value }))} placeholder="SKU" />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="MRP">
                    <Input type="number" value={catalogForm.mrp} onChange={(e) => setCatalogForm((prev) => ({ ...prev, mrp: e.target.value }))} />
                  </Field>
                  <Field label="Price">
                    <Input type="number" value={catalogForm.price} onChange={(e) => setCatalogForm((prev) => ({ ...prev, price: e.target.value }))} />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="BV">
                    <Input type="number" value={catalogForm.bv} onChange={(e) => setCatalogForm((prev) => ({ ...prev, bv: e.target.value }))} />
                  </Field>
                  <Field label="Stock">
                    <Input type="number" value={catalogForm.stock} onChange={(e) => setCatalogForm((prev) => ({ ...prev, stock: e.target.value }))} />
                  </Field>
                </div>
                <Field label="Source product ID">
                  <Input value={catalogForm.source_product_id} onChange={(e) => setCatalogForm((prev) => ({ ...prev, source_product_id: e.target.value }))} placeholder="Optional source product id" />
                </Field>
              </div>
              <div className="rounded-2xl border border-border bg-slate-50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-display font-bold text-emerald-950">Catalog items</p>
                  <span className="text-xs text-slate-500">{catalogRows.length} items</span>
                </div>
                <div className="space-y-2 max-h-[24rem] overflow-y-auto">
                  {catalogRows.length === 0 && <p className="text-sm text-slate-500">No isolated catalog items yet.</p>}
                  {catalogRows.map((item, index) => (
                    <div key={String(item.id || item.catalog_item_id || index)} className="rounded-xl border border-border bg-white p-3">
                      <p className="font-semibold text-emerald-950">{fmt(item.name || item.title || item.sku || item.id)}</p>
                      <p className="text-xs text-slate-500 mt-1">SKU: {fmt(item.sku)}</p>
                      <p className="text-xs text-slate-500">Price: {fmt(item.price)} | Stock: {fmt(item.stock)}</p>
                    </div>
                  ))}
                </div>
                <Button className="w-full rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" disabled={busy} onClick={createCatalogItem}>Create Catalog Item</Button>
              </div>
            </div>
          </Panel>
        </section>

        <section className="space-y-6">
          <Panel icon={Warehouse} title="Inventory allocation" subtitle="Admin-only stock assignment for isolated store owners.">
            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-emerald-950">Selected owner</label>
                <select value={selectedOwnerId} onChange={(e) => setSelectedOwnerId(e.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-input bg-white px-3 text-sm">
                  <option value="">Choose owner</option>
                  {ownerOptions.map((owner) => {
                    const ownerId = String(owner.id || owner.owner_id || "");
                    return <option key={ownerId} value={ownerId}>{ownerLabel(owner)}</option>;
                  })}
                </select>
              </div>

              <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                <div>
                  <label className="text-sm font-semibold text-emerald-950">Commission %</label>
                  <Input type="number" value={selectedCommission} onChange={(e) => setSelectedCommission(e.target.value)} className="mt-1.5 h-11" />
                </div>
                <Button variant="outline" className="rounded-full" disabled={busy || !selectedOwnerId} onClick={updateCommission}>Update</Button>
              </div>

              <div className="space-y-3 rounded-2xl border border-border bg-slate-50 p-4">
                <p className="font-display font-bold text-emerald-950">Allocation details</p>
                <Field label="Catalog item ID">
                  <Input value={allocationForm.catalog_item_id} onChange={(e) => setAllocationForm((prev) => ({ ...prev, catalog_item_id: e.target.value }))} placeholder="Enter catalog item id" />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Quantity">
                    <Input type="number" value={allocationForm.quantity} onChange={(e) => setAllocationForm((prev) => ({ ...prev, quantity: e.target.value }))} />
                  </Field>
                  <Field label="Note">
                    <Input value={allocationForm.note} onChange={(e) => setAllocationForm((prev) => ({ ...prev, note: e.target.value }))} placeholder="Initial allocation" />
                  </Field>
                </div>
              </div>
              <div className="flex gap-2">
                <Button className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" disabled={busy || !selectedOwnerId} onClick={allocateInventory}>Allocate Inventory</Button>
                <Button variant="outline" className="rounded-full" disabled={!selectedOwnerId} onClick={() => loadInventory(selectedOwnerId)}>Load Inventory</Button>
              </div>
            </div>
          </Panel>

          <Panel icon={Receipt} title="Owner stock purchase invoice" subtitle="Admin sells product to owner, collects payment, then stock goes to owner inventory.">
            <div className="space-y-4">
              <p className="text-xs text-slate-600">Owner product order করতে পারবে; admin payment confirm পেলে delivery/stock inventory-তে add হবে.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Invoice no"><Input value={invoiceForm.invoice_no} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, invoice_no: e.target.value }))} placeholder="Optional" /></Field>
                <Field label="Catalog item">
                  <select
                    value={invoiceForm.catalog_item_id}
                    onChange={(e) => setInvoiceForm((prev) => ({ ...prev, catalog_item_id: e.target.value }))}
                    className="h-11 w-full rounded-lg border border-input bg-white px-3 text-sm"
                  >
                    <option value="">Choose store product</option>
                    {methoCatalogRows.map((item, index) => {
                      const value = String(item.id || item.catalog_item_id || item.sku || index).trim();
                      const label = `${item.name || item.title || item.sku || value}${item.product_type ? ` · ${item.product_type}` : ""}${item.price ? ` · ₹${item.price}` : ""}`;
                      return <option key={value} value={value}>{label}</option>;
                    })}
                  </select>
                </Field>
              </div>
              {selectedCatalogItem ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                  Selected product: <span className="font-semibold">{selectedCatalogItem.name || selectedCatalogItem.title || selectedCatalogItem.sku || selectedCatalogItem.id}</span>
                  {selectedCatalogItem.sku ? <span> · SKU {selectedCatalogItem.sku}</span> : null}
                  {selectedCatalogItem.price !== undefined ? <span> · ₹{selectedCatalogItem.price}</span> : null}
                  {selectedCatalogItem.source_product_id ? <span> · Global Link {selectedCatalogItem.source_product_id}</span> : null}
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Quantity"><Input type="number" value={invoiceForm.quantity} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, quantity: e.target.value }))} /></Field>
                <Field label="Unit price"><Input type="number" value={invoiceForm.unit_price} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, unit_price: e.target.value }))} placeholder={selectedCatalogItem?.price ? String(selectedCatalogItem.price) : "0"} /></Field>
                <Field label="Payment method">
                  <select
                    value={invoiceForm.payment_method}
                    onChange={(e) => setInvoiceForm((prev) => ({ ...prev, payment_method: e.target.value }))}
                    className="h-11 w-full rounded-lg border border-input bg-white px-3 text-sm"
                  >
                    <option value="cash">Cash</option>
                    <option value="razorpay">Razorpay</option>
                  </select>
                </Field>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1">
                <p>Gross amount: <span className="font-semibold">₹{purchaseGrossAmount.toLocaleString("en-IN")}</span></p>
                <p>Commission ({purchaseCommissionPercent}%): <span className="font-semibold">₹{purchaseCommissionAmount.toLocaleString("en-IN")}</span></p>
                <p>Payable amount: <span className="font-semibold">₹{purchasePayableAmount.toLocaleString("en-IN")}</span></p>
              </div>
              {invoiceForm.payment_method === "razorpay" ? (
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 space-y-3">
                  <p className="text-xs text-blue-900">Razorpay mode selected. Scan QR, complete payment, then enter payment reference below.</p>
                  {upiQrUrl ? (
                    <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                      <img src={upiQrUrl} alt="Owner payment QR" className="w-40 h-40 rounded border border-blue-200 bg-white p-1" />
                      <div className="text-xs text-blue-900 break-all">
                        <p className="font-semibold">UPI ID: {upiId || "Not configured"}</p>
                        <p className="mt-1">Amount: ₹{purchasePayableAmount.toLocaleString("en-IN")}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-blue-900">Set UPI ID in settings and enter valid amount to generate QR.</p>
                  )}
                  <Field label="Razorpay payment reference">
                    <Input
                      value={invoiceForm.payment_reference}
                      onChange={(e) => setInvoiceForm((prev) => ({ ...prev, payment_reference: e.target.value }))}
                      placeholder="Enter Razorpay payment ID / reference"
                    />
                  </Field>
                </div>
              ) : null}
              <Field label="Notes"><Input value={invoiceForm.notes} onChange={(e) => setInvoiceForm((prev) => ({ ...prev, notes: e.target.value }))} placeholder="Optional note" /></Field>
              <div className="flex gap-2">
                <Button className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" disabled={busy || !selectedOwnerId} onClick={createOwnerInvoice}>Confirm Payment & Add Stock</Button>
                <Button variant="outline" className="rounded-full" disabled={!selectedOwnerId} onClick={() => loadOwnerInvoices(selectedOwnerId)}>Load Invoices</Button>
              </div>
              <div className="space-y-2">
                {ownerInvoices.length === 0 ? (
                  <p className="text-sm text-slate-500">Select owner and load invoices.</p>
                ) : ownerInvoices.map((inv, i) => (
                  <div key={String(inv.id || inv.invoice_id || i)} className="rounded-xl border border-border bg-white p-3">
                    <p className="font-semibold text-emerald-950">{fmt(inv.invoice_no || inv.id || `Invoice ${i + 1}`)}</p>
                    <p className="text-xs text-slate-500 mt-1">Flow: {fmt(inv.flow || "owner_member_sale")}</p>
                    <p className="text-xs text-slate-500">Payment: {fmt(inv.payment_method || "-")} {inv.payment_reference ? `· ${inv.payment_reference}` : ""}</p>
                    <p className="text-xs text-slate-500">Total: {fmt(inv.payable_amount || inv.total || inv.grand_total || inv.amount)}</p>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel icon={Boxes} title="Owner inventory snapshot" subtitle="Read-only view from isolated inventory endpoint.">
            <div className="space-y-3">
              {inventoryRows.length === 0 ? (
                <p className="text-sm text-slate-500">Select an owner and load inventory.</p>
              ) : (
                inventoryRows.map((row, index) => (
                  <div key={String(row.id || row.inventory_id || index)} className="rounded-xl border border-border bg-white p-3">
                    <p className="font-semibold text-emerald-950">{fmt(row.name || row.item_name || row.sku || row.catalog_item_id || row.id)}</p>
                    <p className="text-xs text-slate-500 mt-1">Qty: {fmt(row.quantity || row.qty || row.balance_quantity)}</p>
                    <p className="text-xs text-slate-500">Meta: {fmt(row.note || row.status || row.updated_at)}</p>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </section>
      </div>

      {ownerEditForm && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display font-black text-xl text-emerald-950">Edit owner</h2>
            <Button variant="ghost" className="rounded-full" onClick={() => setOwnerEditForm(null)}>Close</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Owner name"><Input value={ownerEditForm.owner_name} onChange={(e) => setOwnerEditForm((prev) => ({ ...prev, owner_name: e.target.value }))} /></Field>
            <Field label="Store name"><Input value={ownerEditForm.store_name} onChange={(e) => setOwnerEditForm((prev) => ({ ...prev, store_name: e.target.value }))} /></Field>
            <Field label="Phone"><Input value={ownerEditForm.phone} onChange={(e) => setOwnerEditForm((prev) => ({ ...prev, phone: e.target.value }))} /></Field>
            <Field label="WhatsApp"><Input value={ownerEditForm.whatsapp_no || ""} onChange={(e) => setOwnerEditForm((prev) => ({ ...prev, whatsapp_no: e.target.value }))} /></Field>
            <Field label="Email"><Input value={ownerEditForm.email} onChange={(e) => setOwnerEditForm((prev) => ({ ...prev, email: e.target.value }))} /></Field>
            <Field label="Password (optional)" className="sm:col-span-2"><Input type="password" value={ownerEditForm.password || ""} onChange={(e) => setOwnerEditForm((prev) => ({ ...prev, password: e.target.value }))} placeholder="Leave blank to keep current password" /></Field>
            <Field label="Address"><Input value={ownerEditForm.address || ""} onChange={(e) => setOwnerEditForm((prev) => ({ ...prev, address: e.target.value }))} /></Field>
            <Field label="Pincode"><Input value={ownerEditForm.pincode || ""} onChange={(e) => setOwnerEditForm((prev) => ({ ...prev, pincode: e.target.value }))} /></Field>
            <Field label="Google Map URL"><Input value={ownerEditForm.google_map_url || ""} onChange={(e) => setOwnerEditForm((prev) => ({ ...prev, google_map_url: e.target.value }))} /></Field>
            <Field label="City"><Input value={ownerEditForm.city} onChange={(e) => setOwnerEditForm((prev) => ({ ...prev, city: e.target.value }))} /></Field>
            <Field label="State"><Input value={ownerEditForm.state} onChange={(e) => setOwnerEditForm((prev) => ({ ...prev, state: e.target.value }))} /></Field>
            <Field label="Commission %"><Input type="number" value={ownerEditForm.commission_percent} onChange={(e) => setOwnerEditForm((prev) => ({ ...prev, commission_percent: e.target.value }))} /></Field>
          </div>
          <div className="flex gap-2">
            <Button className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white" disabled={busy} onClick={saveOwnerEdit}>Save Changes</Button>
            <Button variant="outline" className="rounded-full" onClick={() => setOwnerEditForm(null)}>Cancel</Button>
          </div>
        </section>
      )}
    </div>
  );
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function clampPercent(value) {
  const n = Number(value) || 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function Panel({ icon: Icon, title, subtitle, children }) {
  return (
    <section className="rounded-2xl border border-border bg-white p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-900 flex items-center justify-center shrink-0"><Icon className="w-5 h-5" /></div>
        <div>
          <h2 className="font-display font-black text-xl text-emerald-950">{title}</h2>
          <p className="text-sm text-slate-500 font-body mt-1">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Field({ label, children, className = "" }) {
  return (
    <div className={className}>
      <label className="text-sm font-semibold text-emerald-950">{label}</label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}