import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Store, Plus, Pencil, Trash2, TrendingUp, Percent, Building, FileSpreadsheet, FileDown, ScrollText, Star, MessageCircle, Images, Upload, CheckCircle2, XCircle, ChevronDown, Search, Eye, Network, Package, LocateFixed, Globe, PhoneCall } from "lucide-react";
import { Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import api from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import OfflineBillingPanel from "@/components/OfflineBillingPanel";
import { resolveAssetUrl } from "@/lib/utils";
import { INDIAN_STATES, isCompletePincode, normalizePincode } from "@/lib/indiaLocation";

const inr = (v) => `₹${(Number(v) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const mapsUrl = (p) => {
  const q = [p.business_name, p.address, p.city, p.state, p.pincode].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};

const haversineKm = (lat1, lon1, lat2, lon2) => {
  const toRad = (v) => (Number(v) * Math.PI) / 180;
  const dLat = toRad(Number(lat2) - Number(lat1));
  const dLon = toRad(Number(lon2) - Number(lon1));
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const toOverpassRegex = (v) => String(v || "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9\s-]/g, " ")
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 6)
  .join("|");

const buildLeadAddress = (tags) => {
  if (!tags || typeof tags !== "object") return "";
  if (tags["addr:full"]) return String(tags["addr:full"]);
  return [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:suburb"],
    tags["addr:city"],
    tags["addr:state"],
    tags["addr:postcode"],
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");
};

const normalizeAddressForSearch = ({ address, city, state, pincode }) => {
  const base = String(address || "").trim();
  const tail = [city, state, pincode]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  if (!tail.length) return base;
  if (!base) return tail.join(", ");

  const lowerBase = base.toLowerCase();
  const missingTail = tail.filter((part) => !lowerBase.includes(part.toLowerCase()));
  if (!missingTail.length) return base;
  return `${base}, ${missingTail.join(", ")}`;
};

const DEFAULT_BUSINESS_TYPES = [
  "Retail Shop", "Super Market", "Pharmacy", "Restaurant",
  "Service Provider", "Distributor", "Wholesaler", "Online Seller",
];

const EMPTY = {
  business_name: "", business_type: "Retail Shop", contact_person: "", phone: "",
  email: "", password: "", address: "", city: "", state: "", pincode: "", gst_no: "", commission_percent: 10,
  upi_id: "", whatsapp_no: "", notes: "", active: true,
};

const DEFAULT_PARTNER_MESSAGE_TEMPLATES = [
  "Hello {business_name}, this is METHO Admin. Your partner code is {partner_code}.",
  "Dear {business_name}, please review your pending approvals in dashboard. - METHO Admin",
  "Hi {contact_person}, your current partner city/category: {city} / {business_type}. - METHO Admin",
];

const LS_BUSINESS_TYPES_KEY = "metho_admin_business_categories_v1";
const LS_CITIES_KEY = "metho_admin_cities_v1";
const LS_MESSAGE_TEMPLATES_KEY = "metho_admin_partner_message_templates_v1";
const GOOGLE_PLACES_API_KEY = process.env.REACT_APP_GOOGLE_PLACES_API_KEY;

const LEAD_FOLLOWUP_STATUSES = ["New", "Attempted", "Connected", "Interested", "Not Interested", "Converted"];

const normalizeLeadName = (v) => String(v || "")
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const leadScoreDetails = (lead, selectedType = "") => {
  let score = 0;
  if (String(lead?.phone || "").trim()) score += 35;

  const d = Number(lead?.distance_km || 9999);
  if (d <= 2) score += 35;
  else if (d <= 5) score += 25;
  else if (d <= 10) score += 15;
  else if (d <= 20) score += 8;
  else score += 3;

  if (String(lead?.address || "").trim()) score += 10;

  const t = String(selectedType || "").trim().toLowerCase();
  if (t && String(lead?.business_type || "").toLowerCase().includes(t)) score += 15;

  const bucket = score >= 75 ? "Hot" : score >= 45 ? "Warm" : "Cold";
  return { score, bucket };
};

export default function PartnersPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const isAdmin = user && (user.role === "super_admin" || user.role === "company_admin" || user.role === "admin");
  const [partners, setPartners] = useState([]);
  const [editing, setEditing] = useState(null); // partner object or {new: true}
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [partnerPincodeBusy, setPartnerPincodeBusy] = useState(false);
  const [ledger, setLedger] = useState(null); // {partner, entries}
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [topupPartner, setTopupPartner] = useState(null);
  const [topupRequests, setTopupRequests] = useState([]);
  const [topupBusy, setTopupBusy] = useState(false);
  const [businessTypes, setBusinessTypes] = useState(DEFAULT_BUSINESS_TYPES);
  const [cities, setCities] = useState([]);
  const [newBusinessType, setNewBusinessType] = useState("");
  const [newCity, setNewCity] = useState("");
  const [cityAdminState, setCityAdminState] = useState("");
  const [cityAdminDistrict, setCityAdminDistrict] = useState("");
  const [locationMetaBusy, setLocationMetaBusy] = useState(false);
  const [indiaLocationMeta, setIndiaLocationMeta] = useState({
    states: [],
    districtsByState: {},
    citiesByStateDistrict: {},
  });
  const [metaBusy, setMetaBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [messageTemplates, setMessageTemplates] = useState(DEFAULT_PARTNER_MESSAGE_TEMPLATES);
  const [newMessageTemplate, setNewMessageTemplate] = useState("");
  const [templateBusy, setTemplateBusy] = useState(false);
  const [messageTarget, setMessageTarget] = useState(null);
  const [messageTemplateIndex, setMessageTemplateIndex] = useState(0);
  const [messageDraft, setMessageDraft] = useState("");
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [showOfflineBilling, setShowOfflineBilling] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [nearbyCity, setNearbyCity] = useState("");
  const [nearbyPincode, setNearbyPincode] = useState("");
  const [nearbyType, setNearbyType] = useState("");
  const [nearbyRadiusKm, setNearbyRadiusKm] = useState(15);
  const [nearbyLocation, setNearbyLocation] = useState(null);
  const [nearbyLocationLabel, setNearbyLocationLabel] = useState("");
  const [nearbyGeoBusy, setNearbyGeoBusy] = useState(false);
  const [nearbySearchBusy, setNearbySearchBusy] = useState(false);
  const [nearbySearchError, setNearbySearchError] = useState("");
  const [nearbySearched, setNearbySearched] = useState(false);
  const [nearbyLeads, setNearbyLeads] = useState([]);
  const [leadFollowupMap, setLeadFollowupMap] = useState({});
  const [dedupeEnabled, setDedupeEnabled] = useState(true);
  const [hotOnly, setHotOnly] = useState(false);
  const lastFormPinRef = useRef("");
  const lastEditPinRef = useRef("");
  const lastNearbyPinRef = useRef("");

  const cityAdminDistrictOptions = useMemo(() => {
    if (!cityAdminState) return [];
    return indiaLocationMeta.districtsByState?.[cityAdminState] || [];
  }, [cityAdminState, indiaLocationMeta.districtsByState]);

  const cityAdminAutoOptions = useMemo(() => {
    if (!cityAdminState || !cityAdminDistrict) {
      return [...cities].sort((a, b) => String(a).localeCompare(String(b)));
    }
    const key = `${cityAdminState.toLowerCase()}||${cityAdminDistrict.toLowerCase()}`;
    const generated = indiaLocationMeta.citiesByStateDistrict?.[key] || [];
    const merged = [...generated, ...cities];
    return Array.from(new Set(merged.map((v) => String(v || "").trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b));
  }, [cityAdminState, cityAdminDistrict, cities, indiaLocationMeta.citiesByStateDistrict]);

  const getApiErrorMessage = (err, fallback) => {
    const status = err?.response?.status;
    const detail = err?.response?.data?.detail;
    const message = err?.response?.data?.message;
    const text = typeof err?.response?.data === "string" ? err.response.data : "";
    const raw = detail || message || text || err?.message;
    if (!raw && !status) return fallback;
    if (!raw) return `${fallback} (${status})`;
    return status ? `${raw} (${status})` : raw;
  };

  const readLocalArray = (key, fallback = []) => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  };

  const writeLocalArray = (key, items) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(Array.isArray(items) ? items : []));
    } catch {
      // ignore local storage write errors
    }
  };

  const tryRequests = async (requests) => {
    let lastErr = null;
    for (const run of requests) {
      try {
        return await run();
      } catch (err) {
        const status = err?.response?.status;
        // Keep trying only when route/method/validation mismatch is likely.
        if (![404, 405, 422].includes(status)) {
          throw err;
        }
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
    throw new Error("No request provided");
  };

  const lookupPincodeAndApply = async (pin, applyFn, pinRef) => {
    const normalized = normalizePincode(pin);
    if (!isCompletePincode(normalized)) return;
    if (pinRef.current === normalized) return;
    setPartnerPincodeBusy(true);
    try {
      const { data } = await api.get(`/directory/pincode-lookup?pincode=${encodeURIComponent(normalized)}`);
      const city = String(data?.city || "").trim();
      const state = String(data?.state || "").trim();
      applyFn((prev) => ({
        ...prev,
        pincode: normalized,
        city: city || prev.city,
        state: state || prev.state,
      }));
      pinRef.current = normalized;
    } catch {
      toast.error("Pincode থেকে city খুঁজে পাওয়া যায়নি");
    } finally {
      setPartnerPincodeBusy(false);
    }
  };

  const hasValue = (arr, val) => arr.some((x) => String(x || "").trim().toLowerCase() === String(val || "").trim().toLowerCase());
  const cleanPhone = (v) => String(v || "").replace(/[^\d]/g, "");
  const addBusinessType = () => {
    const v = newBusinessType.trim();
    if (!v) return;
    if (hasValue(businessTypes, v)) {
      toast.error("এই category already আছে");
      return;
    }
    setBusinessTypes((prev) => [...prev, v]);
    setNewBusinessType("");
  };
  const removeBusinessType = (v) => setBusinessTypes((prev) => prev.filter((x) => String(x || "").trim().toLowerCase() !== String(v || "").trim().toLowerCase()));

  const addCity = () => {
    const v = newCity.trim();
    if (!v) return;
    if (hasValue(cities, v)) {
      toast.error("এই city already আছে");
      return;
    }
    setCities((prev) => [...prev, v]);
    setNewCity("");
  };
  const removeCity = (v) => setCities((prev) => prev.filter((x) => String(x || "").trim().toLowerCase() !== String(v || "").trim().toLowerCase()));

  const fillPartnerTemplate = (tpl, p) => {
    const template = String(tpl || "").trim();
    if (!template) return "";
    const vars = {
      "{business_name}": p?.business_name || "Partner",
      "{contact_person}": p?.contact_person || p?.business_name || "Partner",
      "{partner_code}": p?.partner_code || "",
      "{city}": p?.city || "",
      "{business_type}": p?.business_type || "",
      "{phone}": p?.phone || "",
    };
    let out = template;
    Object.entries(vars).forEach(([key, value]) => {
      out = out.split(key).join(String(value || ""));
    });
    return out;
  };

  const saveBusinessTypes = async () => {
    setMetaBusy(true);
    try {
      const { data } = await api.put("/admin/business-categories", { items: businessTypes });
      const items = Array.isArray(data?.items) ? data.items : businessTypes;
      setBusinessTypes(items);
      writeLocalArray(LS_BUSINESS_TYPES_KEY, items);
      toast.success("Business/Services categories saved");
    } catch (err) {
      if (err?.response?.status === 404) {
        writeLocalArray(LS_BUSINESS_TYPES_KEY, businessTypes);
        toast.success("Categories locally saved");
      } else {
        toast.error(err?.response?.data?.detail || "Failed to save categories");
      }
    } finally {
      setMetaBusy(false);
    }
  };

  const saveCities = async () => {
    setMetaBusy(true);
    try {
      const { data } = await api.put("/admin/cities", { items: cities });
      const items = Array.isArray(data?.items) ? data.items : cities;
      setCities(items);
      writeLocalArray(LS_CITIES_KEY, items);
      toast.success("Cities saved");
    } catch (err) {
      if (err?.response?.status === 404) {
        writeLocalArray(LS_CITIES_KEY, cities);
        toast.success("Cities locally saved");
      } else {
        toast.error(err?.response?.data?.detail || "Failed to save cities");
      }
    } finally {
      setMetaBusy(false);
    }
  };

  const addMessageTemplate = () => {
    const v = newMessageTemplate.trim();
    if (!v) return;
    if (hasValue(messageTemplates, v)) {
      toast.error("এই template already আছে");
      return;
    }
    setMessageTemplates((prev) => [...prev, v]);
    setNewMessageTemplate("");
  };

  const removeMessageTemplate = (v) => {
    setMessageTemplates((prev) => prev.filter((x) => String(x || "").trim().toLowerCase() !== String(v || "").trim().toLowerCase()));
  };

  const saveMessageTemplates = async () => {
    setTemplateBusy(true);
    try {
      const { data } = await api.put("/admin/partner-message-templates", { items: messageTemplates });
      const items = Array.isArray(data?.items) && data.items.length ? data.items : DEFAULT_PARTNER_MESSAGE_TEMPLATES;
      setMessageTemplates(items);
      writeLocalArray(LS_MESSAGE_TEMPLATES_KEY, items);
      toast.success("Partner message templates saved");
    } catch (err) {
      if (err?.response?.status === 404) {
        writeLocalArray(LS_MESSAGE_TEMPLATES_KEY, messageTemplates);
        toast.success("Message templates locally saved");
      } else {
        toast.error(err?.response?.data?.detail || "Failed to save message templates");
      }
    } finally {
      setTemplateBusy(false);
    }
  };

  const loadTopupRequests = async (partnerId) => {
    try {
      const { data } = await api.get("/admin/partner-wallet/topup-requests?status_filter=pending");
      setTopupRequests((data || []).filter((r) => r.partner_id === partnerId));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to load top-up requests");
      setTopupRequests([]);
    }
  };

  const openTopupDialog = async (partner) => {
    setTopupPartner(partner);
    await loadTopupRequests(partner.id);
  };

  const approveTopup = async (reqId) => {
    setTopupBusy(true);
    try {
      await api.post(`/admin/partner-wallet/topup-requests/${reqId}/approve`, {});
      toast.success("Top-up approved and wallet credited");
      await load();
      await loadTopupRequests(topupPartner.id);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Approve failed");
    } finally {
      setTopupBusy(false);
    }
  };

  const rejectTopup = async (reqId) => {
    setTopupBusy(true);
    try {
      await api.post(`/admin/partner-wallet/topup-requests/${reqId}/reject`, {});
      toast.success("Top-up rejected");
      await loadTopupRequests(topupPartner.id);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Reject failed");
    } finally {
      setTopupBusy(false);
    }
  };

  const uploadTopupQr = async (partnerId, file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api.post(`/admin/partners/${partnerId}/upload-metho-topup-qr`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("METHO top-up QR uploaded for this partner");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "QR upload failed");
    }
  };

  const openLedger = async (p) => {
    try {
      const { data } = await api.get(`/admin/partners/${p.id}/ledger`);
      setLedger(data);
    } catch (err) { toast.error("Failed to load ledger"); }
  };

  const sendPartnerMessage = (p) => {
    const phone = cleanPhone(p.whatsapp_no || p.phone);
    if (!phone) {
      toast.error("Partner phone/WhatsApp not found");
      return;
    }
    const firstTemplate = messageTemplates[0] || DEFAULT_PARTNER_MESSAGE_TEMPLATES[0];
    setMessageTarget(p);
    setMessageTemplateIndex(0);
    setMessageDraft(fillPartnerTemplate(firstTemplate, p));
  };

  const applyTemplateToDraft = (idx, partner = messageTarget) => {
    const safeIdx = Number(idx) || 0;
    const tpl = messageTemplates[safeIdx] || "";
    setMessageTemplateIndex(safeIdx);
    setMessageDraft(fillPartnerTemplate(tpl, partner));
  };

  const openWhatsappWithDraft = () => {
    const p = messageTarget;
    if (!p) return;
    const phone = cleanPhone(p.whatsapp_no || p.phone);
    if (!phone) {
      toast.error("Partner phone/WhatsApp not found");
      return;
    }
    if (!messageDraft.trim()) {
      toast.error("Message empty");
      return;
    }
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(messageDraft.trim())}`, "_blank");
    setMessageTarget(null);
  };

  const cleanupDemoPartners = async () => {
    if (cleanupBusy) return;
    setCleanupBusy(true);
    try {
      const previewResp = await tryRequests([
        () => api.post("/admin/partners/cleanup-demo", { confirm: false }),
        () => api.post("/admin/partners/cleanup-demo", { preview: true }),
        () => api.get("/admin/partners/cleanup-demo?preview=true"),
      ]);
      const candidates = Array.isArray(previewResp?.data?.candidates) ? previewResp.data.candidates : [];
      if (!candidates.length) {
        toast.success("No demo/test partner found");
        return;
      }

      const proceed = window.confirm(`Found ${candidates.length} demo/test partners. Delete now?`);
      if (!proceed) return;

      const code = window.prompt("Type DELETE_DEMO_PARTNERS to confirm permanent delete:\n(Case-sensitive, no extra spaces)", "");
      if (!code || code.trim() !== "DELETE_DEMO_PARTNERS") {
        if (code === null) {
          toast.info("Cleanup cancelled.");
        } else {
          toast.error(`Cleanup cancelled. You typed "${code}" but must type exactly: DELETE_DEMO_PARTNERS`);
        }
        return;
      }

      const { data } = await tryRequests([
        () => api.post("/admin/partners/cleanup-demo", { confirm: true, confirm_text: code }),
        () => api.post("/admin/partners/cleanup-demo", { confirm: code }),
        () => api.post("/admin/partners/cleanup-demo", { confirm_text: code }),
      ]);
      toast.success(`Deleted ${data?.deleted_count || 0} demo/test partners`);
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Demo partner cleanup failed"));
    } finally {
      setCleanupBusy(false);
    }
  };

  const filteredPartners = useMemo(() => {
    const term = search.trim().toLowerCase();
    return partners.filter((p) => {
      const matchesText = !term || [
        p.business_name,
        p.partner_code,
        p.business_type,
        p.city,
        p.phone,
        p.whatsapp_no,
        String(p.total_sales || ""),
        String(p.total_commission_paid || ""),
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term));
      const matchesCity = !cityFilter || String(p.city || "").trim().toLowerCase() === cityFilter.trim().toLowerCase();
      const matchesType = !typeFilter || String(p.business_type || "").trim().toLowerCase() === typeFilter.trim().toLowerCase();
      return matchesText && matchesCity && matchesType;
    });
  }, [partners, search, cityFilter, typeFilter]);

  const selectedPartner = useMemo(
    () => partners.find((p) => String(p.id || "") === String(selectedPartnerId || "")) || null,
    [partners, selectedPartnerId]
  );

  const exportLedgerExcel = () => {
    if (!ledger) return;
    import("xlsx")
      .then((XLSX) => {
        const wb = XLSX.utils.book_new();
        const p = ledger.partner;
        const summaryRows = [
          ["METHOO STORE — Partner Ledger", ""],
          ["Partner Code", p.partner_code], ["Business Name", p.business_name],
          ["Business Type", p.business_type], ["Contact", `${p.contact_person} · ${p.phone}`],
          ["GST No", p.gst_no || "—"], ["Commission %", p.commission_percent],
          ["Total Sales", p.total_sales || 0], ["Total Commission Paid", p.total_commission_paid || 0],
          ["Generated", new Date().toLocaleString()], [],
        ];
        const s1 = XLSX.utils.aoa_to_sheet(summaryRows);
        s1["!cols"] = [{ wch: 30 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(wb, s1, "Summary");

        const entryRows = [
          ["Date", "Order Ref", "Period", "Sales (₹)", "Commission %", "Commission (₹)"],
          ...ledger.entries.map((e) => [
            new Date(e.created_at).toLocaleString(),
            e.ref_order_id, e.period,
            e.sales_amount, e.commission_percent, e.commission_amount,
          ]),
          [], ["TOTAL", "", "", ledger.entries.reduce((s, e) => s + (e.sales_amount || 0), 0), "", ledger.entries.reduce((s, e) => s + (e.commission_amount || 0), 0)],
        ];
        const s2 = XLSX.utils.aoa_to_sheet(entryRows);
        s2["!cols"] = [{ wch: 24 }, { wch: 40 }, { wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, s2, "Ledger Entries");

        XLSX.writeFile(wb, `Partner_${p.partner_code}_Ledger.xlsx`);
        toast.success("Ledger exported");
      })
      .catch(() => toast.error("Excel export module failed to load"));
  };

  const downloadPartnerPdf = (p) => {
    import("jspdf")
      .then(({ jsPDF }) => {
        const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
        const W = doc.internal.pageSize.getWidth();

        doc.setFillColor(5, 46, 22);
        doc.rect(0, 0, W, 28, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(16);
        doc.text("METHOO STORE Partner Profile", 10, 12);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.text(`Generated: ${new Date().toLocaleString()}`, 10, 20);

        let y = 40;
        const write = (label, value) => {
          doc.setTextColor(71, 85, 105);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text(label, 10, y);
          doc.setTextColor(5, 46, 22);
          doc.setFont("helvetica", "normal");
          doc.text(String(value ?? "—"), 55, y);
          y += 7;
        };

        write("Partner Code", p.partner_code);
        write("Business Name", p.business_name);
        write("Business Type", p.business_type);
        write("Contact Person", p.contact_person);
        write("Phone", p.phone);
        write("WhatsApp", p.whatsapp_no || p.phone);
        write("Email", p.email || "—");
        write("GST No", p.gst_no || "—");
        write("Commission %", `${p.commission_percent ?? p.agreement_percent ?? 0}%`);
        write("Status", p.active !== false ? "Active" : "Inactive");
        write("Address", p.address || "—");
        write("City", p.city || "—");
        write("State", p.state || "—");
        write("Pincode", p.pincode || "—");
        y += 4;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text("Financial Summary", 10, y);
        y += 6;
        doc.setFont("helvetica", "normal");
        write("Total Sales", inr(p.total_sales || 0));
        write("Commission Paid", inr(p.total_commission_paid || 0));
        write("Reserve Wallet", inr(p.wallet?.balance || 0));

        doc.setTextColor(148, 163, 184);
        doc.setFontSize(7);
        doc.text(`Partner shop: ${window.location.origin}/partner-shop/${p.partner_code}`, 10, 285);
        doc.save(`Partner_${p.partner_code}_Profile.pdf`);
        toast.success("Partner PDF downloaded");
      })
      .catch(() => toast.error("PDF export module failed to load"));
  };

  const load = () => api.get("/admin/partners")
    .then((r) => {
      setPartners(Array.isArray(r.data) ? r.data : []);
      setLoadError("");
    })
    .catch(async (err) => {
      try {
        const fb = await api.get("/partners");
        const rows = Array.isArray(fb.data) ? fb.data : [];
        const mapped = rows.map((p) => ({
          ...p,
          contact_person: p.contact_person || "",
          address: p.address || "",
          city: p.city || "",
          state: p.state || "",
          pincode: p.pincode || "",
          gst_no: p.gst_no || "",
          upi_id: p.upi_id || "",
          whatsapp_no: p.whatsapp_no || p.phone || "",
          agreement_percent: p.commission_percent ?? 10,
          total_commission_paid: Number(p.total_commission_paid || 0),
          wallet: p.wallet || { balance: 0, total_credit: 0, total_debit: 0 },
          pending_topup_requests: Number(p.pending_topup_requests || 0),
          is_featured: !!p.is_featured,
        }));
        setPartners(mapped);
        const detail = err?.response?.data?.detail;
        const status = err?.response?.status;
        setLoadError(`Admin feed issue (${status || "network"}). Fallback list loaded.${detail ? ` ${detail}` : ""}`);
        return;
      } catch {
        const detail = err?.response?.data?.detail;
        const status = err?.response?.status;
        const msg = detail || (status ? `Load failed (${status})` : "Load failed");
        setLoadError(msg);
        toast.error(msg);
      }
    });

  const detectCurrentLocation = async () => {
    if (!navigator?.geolocation) {
      toast.error("Browser geolocation support পাওয়া যায়নি");
      return;
    }
    setNearbyGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude);
        const lng = Number(pos.coords.longitude);
        setNearbyLocation({ lat, lng });
        setNearbyLocationLabel(`Lat ${lat.toFixed(5)}, Lng ${lng.toFixed(5)} (Current)`);
        setNearbyGeoBusy(false);
        toast.success("Current location detected");
      },
      () => {
        setNearbyGeoBusy(false);
        toast.error("Current location detect করা যায়নি");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  const useCityCenter = async () => {
    const city = String(nearbyCity || "").trim();
    const normalizedPin = normalizePincode(nearbyPincode);
    const geoNeedle = isCompletePincode(normalizedPin)
      ? `${normalizedPin}, India`
      : `${city}, India`;
    if (!String(geoNeedle || "").trim() || geoNeedle === ", India") {
      toast.error("City বা pincode দিন");
      return;
    }
    setNearbyGeoBusy(true);
    try {
      const endpoint = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(geoNeedle)}`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error("geocode failed");
      const rows = await res.json();
      const first = Array.isArray(rows) ? rows[0] : null;
      const lat = Number(first?.lat);
      const lng = Number(first?.lon);
      const canonicalCity = String(first?.name || city).trim();
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        toast.error("City location পাওয়া যায়নি");
        return;
      }
      if (canonicalCity) {
        setNearbyCity(canonicalCity);
      }
      setNearbyLocation({ lat, lng });
      setNearbyLocationLabel(`${canonicalCity || city} Center`);
      toast.success("City center selected");
    } catch {
      toast.error("City location fetch করা যায়নি");
    } finally {
      setNearbyGeoBusy(false);
    }
  };

  const fetchGoogleLeads = async ({ radiusKm, radiusM, cityNeedle }) => {
    if (!GOOGLE_PLACES_API_KEY) return [];

    const queryParts = [
      String(nearbyType || "").trim() || "business",
      cityNeedle ? `in ${String(nearbyCity || "").trim()}` : "near me",
      "India",
    ].filter(Boolean);

    const body = {
      textQuery: queryParts.join(" "),
      languageCode: "en",
      regionCode: "IN",
      maxResultCount: 20,
      locationBias: {
        circle: {
          center: {
            latitude: Number(nearbyLocation.lat),
            longitude: Number(nearbyLocation.lng),
          },
          radius: Number(radiusM),
        },
      },
    };

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.location",
          "places.nationalPhoneNumber",
          "places.internationalPhoneNumber",
          "places.websiteUri",
          "places.types",
          "places.primaryTypeDisplayName",
          "places.googleMapsUri",
          "places.businessStatus",
        ].join(","),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`google places failed (${res.status})`);
    }

    const payload = await res.json();
    const items = Array.isArray(payload?.places) ? payload.places : [];

    return items
      .map((place, idx) => {
        const lat = Number(place?.location?.latitude);
        const lng = Number(place?.location?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

        const name = String(place?.displayName?.text || "").trim();
        if (!name) return null;

        const website = String(place?.websiteUri || "").trim();
        // Keep only offline/no-website style leads.
        if (website) return null;

        const phone = cleanPhone(place?.nationalPhoneNumber || place?.internationalPhoneNumber || "");
        const address = String(place?.formattedAddress || "").trim();
        const city = String(nearbyCity || "").trim();
        const distanceKm = haversineKm(nearbyLocation.lat, nearbyLocation.lng, lat, lng);
        const typeLabel = String(
          place?.primaryTypeDisplayName?.text
          || (Array.isArray(place?.types) ? place.types[0] : "business")
          || "business"
        ).replace(/_/g, " ");

        if (!Number.isFinite(distanceKm) || distanceKm > radiusKm) return null;

        return {
          id: `gplace-${place?.id || idx}`,
          business_name: name,
          business_type: typeLabel,
          city,
          address,
          phone,
          website,
          distance_km: distanceKm,
          lat,
          lng,
          map_url: String(place?.googleMapsUri || "").trim(),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance_km - b.distance_km);
  };

  const fetchOverpassLeads = async ({ radiusKm, radiusM, regex, cityNeedle }) => {
    const genericSelectors = [
      `node["shop"](around:${radiusM},${nearbyLocation.lat},${nearbyLocation.lng});`,
      `way["shop"](around:${radiusM},${nearbyLocation.lat},${nearbyLocation.lng});`,
      `node["amenity"](around:${radiusM},${nearbyLocation.lat},${nearbyLocation.lng});`,
      `way["amenity"](around:${radiusM},${nearbyLocation.lat},${nearbyLocation.lng});`,
      `node["office"](around:${radiusM},${nearbyLocation.lat},${nearbyLocation.lng});`,
      `way["office"](around:${radiusM},${nearbyLocation.lat},${nearbyLocation.lng});`,
    ];
    const targetedSelectors = regex
      ? [
        `node["name"~"${regex}",i](around:${radiusM},${nearbyLocation.lat},${nearbyLocation.lng});`,
        `way["name"~"${regex}",i](around:${radiusM},${nearbyLocation.lat},${nearbyLocation.lng});`,
        `node["shop"~"${regex}",i](around:${radiusM},${nearbyLocation.lat},${nearbyLocation.lng});`,
        `way["shop"~"${regex}",i](around:${radiusM},${nearbyLocation.lat},${nearbyLocation.lng});`,
        `node["amenity"~"${regex}",i](around:${radiusM},${nearbyLocation.lat},${nearbyLocation.lng});`,
        `way["amenity"~"${regex}",i](around:${radiusM},${nearbyLocation.lat},${nearbyLocation.lng});`,
      ]
      : [];

    const overpassQuery = `[out:json][timeout:30];(\n${[...targetedSelectors, ...genericSelectors].join("\n")}\n);out center tags 800;`;

    const OVERPASS_MIRRORS = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.openstreetmap.ru/api/interpreter",
    ];
    let resp = null;
    for (const mirror of OVERPASS_MIRRORS) {
      try {
        const r = await fetch(mirror, { method: "POST", body: overpassQuery });
        if (r.ok) { resp = r; break; }
      } catch { /* try next mirror */ }
    }
    if (!resp) throw new Error("overpass failed");
    const payload = await resp.json();
    const items = Array.isArray(payload?.elements) ? payload.elements : [];

    return items
      .map((item, idx) => {
        const tags = item?.tags || {};
        const lat = Number(item?.lat ?? item?.center?.lat);
        const lng = Number(item?.lon ?? item?.center?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

        const name = String(tags?.name || "").trim();
        if (!name) return null;

        const address = buildLeadAddress(tags);
        const website = String(tags?.website || tags?.["contact:website"] || "").trim();
        const social = String(tags?.facebook || tags?.instagram || tags?.["contact:facebook"] || tags?.["contact:instagram"] || "").trim();
        const phone = cleanPhone(tags?.phone || tags?.mobile || tags?.["contact:phone"] || tags?.["contact:mobile"] || "");
        const city = String(tags?.["addr:city"] || "").trim();
        const hasOnline = !!website || !!social;
        if (hasOnline) return null;

        if (cityNeedle) {
          const compare = `${city} ${address}`.toLowerCase();
          if (compare && !compare.includes(cityNeedle)) return null;
        }

        const distanceKm = haversineKm(nearbyLocation.lat, nearbyLocation.lng, lat, lng);
        const leadType = String(tags?.shop || tags?.amenity || tags?.office || tags?.craft || tags?.tourism || "business").replace(/_/g, " ");
        return {
          id: `${item?.type || "lead"}-${item?.id || idx}`,
          business_name: name,
          business_type: leadType,
          city,
          address,
          phone,
          website,
          distance_km: distanceKm,
          lat,
          lng,
        };
      })
      .filter(Boolean)
      .filter((lead) => Number.isFinite(lead.distance_km) && lead.distance_km <= radiusKm)
      .sort((a, b) => a.distance_km - b.distance_km);
  };

  const searchExternalLeads = async () => {
    if (!nearbyLocation) {
      toast.error("আগে current location বা city center set করুন");
      return;
    }

    const radiusKm = Math.max(1, Number(nearbyRadiusKm) || 15);
    const radiusM = Math.max(1000, Math.round(radiusKm * 1000));
    const regex = toOverpassRegex(nearbyType);
    const cityNeedle = String(nearbyCity || "").trim().toLowerCase();

    setNearbySearchBusy(true);
    setNearbySearchError("");
    try {
      let mapped = [];
      let usedSource = "overpass";

      if (GOOGLE_PLACES_API_KEY) {
        try {
          mapped = await fetchGoogleLeads({ radiusKm, radiusM, cityNeedle });
          if (mapped.length) {
            usedSource = "google";
          }
        } catch {
          // Keep existing flow by falling back to Overpass.
        }
      }

      if (!mapped.length) {
        mapped = await fetchOverpassLeads({ radiusKm, radiusM, regex, cityNeedle });
      }

      const dedupMap = new Map();
      mapped.forEach((lead) => {
        const key = `${lead.business_name.toLowerCase()}|${lead.phone}|${lead.lat.toFixed(4)}|${lead.lng.toFixed(4)}`;
        if (!dedupMap.has(key)) dedupMap.set(key, lead);
      });
      const finalLeads = Array.from(dedupMap.values()).slice(0, 300);
      setNearbyLeads(finalLeads);
      setNearbySearched(true);
      if (usedSource === "google") {
        toast.success(`Google leads found: ${finalLeads.length}`);
      }
    } catch {
      setNearbyLeads([]);
      setNearbySearched(true);
      setNearbySearchError("External lead search failed. কিছুক্ষণ পরে আবার চেষ্টা করুন।");
    } finally {
      setNearbySearchBusy(false);
    }
  };

  const exportExternalLeadsCsv = (onlyWithPhone = false) => {
    const sourceBase = dedupedRankedLeads;
    const source = onlyWithPhone
      ? sourceBase.filter((lead) => String(lead?.phone || "").trim())
      : sourceBase;

    if (!source.length) {
      toast.error("Export করার মতো lead নেই");
      return;
    }

    const headers = ["Business Name", "Type", "City", "Address", "Phone", "Distance (km)", "Score", "Priority", "Follow-up", "Map URL"];
    const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = source.map((lead) => {
      const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lead.business_name} ${lead.address || ""}`)}`;
      return [
        lead.business_name,
        lead.business_type,
        lead.city,
        lead.address,
        lead.phone,
        Number(lead.distance_km || 0).toFixed(2),
        Number(lead.lead_score || 0),
        lead.priority_bucket || "Cold",
        lead.follow_up_status || "New",
        mapUrl,
      ].map(escapeCsv).join(",");
    });

    const csv = [headers.map(escapeCsv).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    a.href = url;
    a.download = `${onlyWithPhone ? "external-offline-leads-phone-only" : "external-offline-leads"}-${ts}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  };

  const updateLeadFollowup = (leadId, status) => {
    setLeadFollowupMap((prev) => ({ ...prev, [leadId]: status }));
  };

  const dedupedRankedLeads = useMemo(() => {
    const ranked = (nearbyLeads || []).map((lead) => {
      const details = leadScoreDetails(lead, nearbyType);
      const follow = leadFollowupMap[lead.id] || "New";
      return {
        ...lead,
        lead_score: details.score,
        priority_bucket: details.bucket,
        follow_up_status: follow,
      };
    });

    if (!dedupeEnabled) {
      return ranked.sort((a, b) => (b.lead_score - a.lead_score) || (a.distance_km - b.distance_km));
    }

    const byKey = new Map();
    ranked.forEach((lead) => {
      const nameKey = normalizeLeadName(lead.business_name);
      const phoneKey = String(lead.phone || "").trim();
      const latBucket = Number.isFinite(Number(lead.lat)) ? Number(lead.lat).toFixed(3) : "0";
      const lngBucket = Number.isFinite(Number(lead.lng)) ? Number(lead.lng).toFixed(3) : "0";
      const cityKey = String(lead.city || "").trim().toLowerCase();
      const key = phoneKey ? `${nameKey}|${phoneKey}` : `${nameKey}|${cityKey}|${latBucket}|${lngBucket}`;

      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, { ...lead, duplicate_count: 1 });
        return;
      }

      const prevScore = Number(prev.lead_score || 0);
      const curScore = Number(lead.lead_score || 0);
      const keepCurrent = curScore > prevScore || (curScore === prevScore && Number(lead.distance_km || 9999) < Number(prev.distance_km || 9999));
      if (keepCurrent) {
        byKey.set(key, { ...lead, duplicate_count: Number(prev.duplicate_count || 1) + 1 });
      } else {
        byKey.set(key, { ...prev, duplicate_count: Number(prev.duplicate_count || 1) + 1 });
      }
    });

    return Array.from(byKey.values())
      .sort((a, b) => (b.lead_score - a.lead_score) || (a.distance_km - b.distance_km));
  }, [nearbyLeads, nearbyType, leadFollowupMap, dedupeEnabled]);

  const scoreSummary = useMemo(() => {
    const total = dedupedRankedLeads.length;
    const hot = dedupedRankedLeads.filter((x) => x.priority_bucket === "Hot").length;
    const warm = dedupedRankedLeads.filter((x) => x.priority_bucket === "Warm").length;
    const cold = total - hot - warm;
    return { total, hot, warm, cold };
  }, [dedupedRankedLeads]);

  const visibleLeads = useMemo(() => {
    if (!hotOnly) return dedupedRankedLeads;
    return dedupedRankedLeads.filter((lead) => lead.priority_bucket === "Hot");
  }, [dedupedRankedLeads, hotOnly]);

  useEffect(() => { if (isAdmin) load(); /* eslint-disable-next-line */ }, [isAdmin]);
  useEffect(() => {
    if (!isAdmin) return;
    api.get("/admin/business-categories")
      .then((r) => {
        const items = Array.isArray(r.data?.items) ? r.data.items : [];
        if (items.length) {
          setBusinessTypes(items);
          writeLocalArray(LS_BUSINESS_TYPES_KEY, items);
          return;
        }
        const cached = readLocalArray(LS_BUSINESS_TYPES_KEY, []);
        if (cached.length) setBusinessTypes(cached);
      })
      .catch(() => {
        const cached = readLocalArray(LS_BUSINESS_TYPES_KEY, []);
        if (cached.length) setBusinessTypes(cached);
      });
    api.get("/admin/cities")
      .then((r) => {
        const items = Array.isArray(r.data?.items) ? r.data.items : [];
        if (items.length) {
          setCities(items);
          writeLocalArray(LS_CITIES_KEY, items);
          return;
        }
        const cached = readLocalArray(LS_CITIES_KEY, []);
        setCities(cached);
      })
      .catch(() => {
        const cached = readLocalArray(LS_CITIES_KEY, []);
        setCities(cached);
      });

    api.get("/admin/partner-message-templates")
      .then((r) => {
        const items = Array.isArray(r.data?.items) ? r.data.items : [];
        if (items.length) {
          setMessageTemplates(items);
          writeLocalArray(LS_MESSAGE_TEMPLATES_KEY, items);
          return;
        }
        const cached = readLocalArray(LS_MESSAGE_TEMPLATES_KEY, []);
        if (cached.length) setMessageTemplates(cached);
      })
      .catch(() => {
        const cached = readLocalArray(LS_MESSAGE_TEMPLATES_KEY, []);
        if (cached.length) setMessageTemplates(cached);
      });
  }, [isAdmin]);

  useEffect(() => {
    if (!partners.length) {
      setSelectedPartnerId("");
      return;
    }
    if (!selectedPartnerId || !partners.some((p) => String(p.id) === String(selectedPartnerId))) {
      setSelectedPartnerId(String(partners[0].id));
    }
  }, [partners, selectedPartnerId]);

  useEffect(() => {
    const normalized = normalizePincode(nearbyPincode);
    if (!isCompletePincode(normalized)) return;
    if (lastNearbyPinRef.current === normalized) return;

    let cancelled = false;
    api.get(`/directory/pincode-lookup?pincode=${encodeURIComponent(normalized)}`)
      .then(({ data }) => {
        if (cancelled) return;
        const city = String(data?.city || "").trim();
        if (city) setNearbyCity(city);
        lastNearbyPinRef.current = normalized;
      })
      .catch(() => {
        if (!cancelled) {
          toast.error("Nearby search pincode থেকে city খুঁজে পাওয়া যায়নি");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [nearbyPincode]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    let idleId = null;
    let timerId = null;

    const loadLocationMeta = () => {
      setLocationMetaBusy(true);
      import("indian-pincodes")
        .then((mod) => {
          if (cancelled) return;
          const pkg = mod?.default || mod;
          const allRows = typeof pkg?.getAllPincodes === "function" ? pkg.getAllPincodes() : [];
          const rows = Array.isArray(allRows) ? allRows : [];
          const statesSet = new Set();
          const districtsMap = {};
          const citiesMap = {};

          rows.forEach((row) => {
            const state = String(row?.state || "").trim();
            const district = String(row?.district || "").trim();
            const city = String(row?.name || "").trim();
            if (!state || !district) return;
            statesSet.add(state);
            if (!districtsMap[state]) districtsMap[state] = new Set();
            districtsMap[state].add(district);
            if (city) {
              const key = `${state.toLowerCase()}||${district.toLowerCase()}`;
              if (!citiesMap[key]) citiesMap[key] = new Set();
              citiesMap[key].add(city);
            }
          });

          const states = Array.from(statesSet).sort((a, b) => a.localeCompare(b));
          const districtsByState = Object.fromEntries(
            Object.entries(districtsMap).map(([state, districts]) => [state, Array.from(districts).sort((a, b) => a.localeCompare(b))])
          );
          const citiesByStateDistrict = Object.fromEntries(
            Object.entries(citiesMap).map(([key, citySet]) => [key, Array.from(citySet).sort((a, b) => a.localeCompare(b))])
          );

          setIndiaLocationMeta({ states, districtsByState, citiesByStateDistrict });
          if (states.length) {
            setCityAdminState((prev) => prev || states[0]);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setIndiaLocationMeta({ states: [...INDIAN_STATES], districtsByState: {}, citiesByStateDistrict: {} });
          }
        })
        .finally(() => {
          if (!cancelled) setLocationMetaBusy(false);
        });
    };

    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(loadLocationMeta, { timeout: 2000 });
    } else {
      timerId = window.setTimeout(loadLocationMeta, 450);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!cityAdminState) {
      setCityAdminDistrict("");
      return;
    }
    if (!cityAdminDistrictOptions.length) {
      setCityAdminDistrict("");
      return;
    }
    if (!cityAdminDistrictOptions.includes(cityAdminDistrict)) {
      setCityAdminDistrict(cityAdminDistrictOptions[0]);
    }
  }, [cityAdminDistrict, cityAdminDistrictOptions, cityAdminState]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextSearch = params.get("search") || "";
    const nextCity = params.get("city") || "";
    const nextType = params.get("type") || "";
    setSearch(nextSearch);
    setCityFilter(nextCity);
    setTypeFilter(nextType);
  }, [location.search]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const apply = (key, value) => {
      const normalized = String(value || "").trim();
      if (normalized) params.set(key, normalized);
      else params.delete(key);
    };
    apply("search", search);
    apply("city", cityFilter);
    apply("type", typeFilter);
    const next = params.toString();
    const current = String(location.search || "").replace(/^\?/, "");
    if (next !== current) {
      nav({ pathname: location.pathname, search: next ? `?${next}` : "" }, { replace: true });
    }
  }, [search, cityFilter, typeFilter, nav, location.pathname, location.search]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("metho_external_lead_followups_v1");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && typeof data === "object") {
        setLeadFollowupMap(data);
      }
    } catch {
      // Ignore localStorage parsing errors.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("metho_external_lead_followups_v1", JSON.stringify(leadFollowupMap));
    } catch {
      // Ignore storage write errors.
    }
  }, [leadFollowupMap]);

  if (!isAdmin) return <Navigate to="/app" replace />;

  const openNew = () => { setForm(EMPTY); setEditing({ new: true }); };
  const openEdit = (p) => {
    setForm({
      business_name: p.business_name, business_type: p.business_type,
      contact_person: p.contact_person, phone: p.phone, email: p.email || "",
      password: "", address: p.address, city: p.city || "", state: p.state || "", pincode: p.pincode || "", gst_no: p.gst_no || "", commission_percent: p.commission_percent ?? 10,
      upi_id: p.upi_id || "", whatsapp_no: p.whatsapp_no || "", notes: p.notes || "", active: p.active !== false,
    });
    setEditing(p);
  };

  const toggleFeatured = async (p) => {
    try {
      const { data } = await api.post(`/admin/partners/${p.id}/toggle-featured`);
      toast.success(data.is_featured ? `⭐ ${p.business_name} is now Featured!` : `Unfeatured ${p.business_name}`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        address: normalizeAddressForSearch({
          address: form.address,
          city: form.city,
          state: form.state,
          pincode: form.pincode,
        }),
        login_password: (form.password || "").trim() || undefined,
      };
      delete payload.password;
      if (editing?.new) {
        const { data } = await api.post("/admin/partners", payload);
        toast.success("Partner registered!");
        if (data?.login_email && data?.login_password) {
          window.prompt(
            `Partner login created. Copy and share now (shown once):\nID: ${data.login_email}`,
            data.login_password
          );
        }
      } else {
        await api.put(`/admin/partners/${editing.id}`, payload);
        toast.success("Partner updated");
      }
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  const deactivate = async (p) => {
    if (!window.confirm(`Block ${p.business_name}? তারা login করতে পারবে না কিন্তু data থাকবে।`)) return;
    try {
      await api.delete(`/admin/partners/${p.id}`);
      toast.success("Partner blocked");
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed");
    }
  };

  const reactivate = async (p) => {
    if (!window.confirm(`Reactivate ${p.business_name}?`)) return;
    try {
      await api.post(`/admin/partners/${p.id}/reactivate`);
      toast.success(`${p.business_name} reactivated`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Reactivate failed");
    }
  };

  const deletePartner = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await tryRequests([
        () => api.delete(`/admin/partners/${deleteTarget.id}/permanent`),
        () => api.delete(`/admin/partners/${deleteTarget.id}?permanent=true`),
        () => api.post(`/admin/partners/${deleteTarget.id}/permanent`),
        () => api.post(`/admin/partners/${deleteTarget.id}/delete`, { permanent: true }),
      ]);
      toast.success(`${deleteTarget.business_name} permanently deleted`);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Delete failed"));
    } finally { setDeleteBusy(false); }
  };

  const totalSales = partners.reduce((s, p) => s + (p.total_sales || 0), 0);
  const totalCommission = partners.reduce((s, p) => s + (p.total_commission_paid || 0), 0);
  const totalServiceBookings = partners.reduce((s, p) => s + Number(p.service_booking_count || 0), 0);
  const totalServiceSales = partners.reduce((s, p) => s + Number(p.service_sales_total || 0), 0);

  return (
    <div className="space-y-6" data-testid="partners-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Admin</p>
          <h1 className="font-display font-black text-3xl md:text-4xl text-emerald-950 tracking-tight mt-1">Associate Partners</h1>
          <p className="text-sm text-muted-foreground font-body mt-1">
            Partner approval-এ requested commission auto-apply হবে। Admin এখান থেকে edit, deactivate, delete, feature, এবং ledger control করবে।
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="rounded-full h-11" data-testid="partners-admin-controls-trigger">
                Partner Admin Control <ChevronDown className="w-4 h-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => { setSearch(""); setCityFilter(""); setTypeFilter(""); load(); }}>
                <Eye className="w-4 h-4 mr-2" /> View All Partners
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => nav("/app/partner-approvals")}>
                <CheckCircle2 className="w-4 h-4 mr-2" /> Partner Applications
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => nav("/app/product-approvals")}>
                <Package className="w-4 h-4 mr-2" /> Product Approvals
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLoadError("")}>
                <XCircle className="w-4 h-4 mr-2" /> Clear Error Banner
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            onClick={cleanupDemoPartners}
            variant="outline"
            className="rounded-full h-11 border-red-300 text-red-700 hover:bg-red-50"
            data-testid="cleanup-demo-partners"
            disabled={cleanupBusy}
          >
            <Trash2 className="w-4 h-4 mr-2" /> {cleanupBusy ? "Cleaning..." : "Delete Demo/Test Partners"}
          </Button>
          <Button onClick={openNew} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full h-11 px-5" data-testid="new-partner-button">
            <Plus className="w-4 h-4 mr-2" /> Register New Partner
          </Button>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" data-testid="partners-load-error-banner">
          Partner list load error: {loadError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-border p-5" data-testid="stat-total-partners">
          <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center"><Building className="w-5 h-5 text-emerald-800" /></div><div><p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Active Partners</p><p className="font-display font-black text-2xl text-emerald-950">{partners.filter(p => p.active !== false).length} / {partners.length}</p></div></div>
        </div>
        <div className="bg-white rounded-xl border border-border p-5">
          <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center"><TrendingUp className="w-5 h-5 text-amber-700" /></div><div><p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Total Partner Sales</p><p className="font-display font-black text-2xl text-emerald-950">{inr(totalSales)}</p></div></div>
        </div>
        <div className="bg-white rounded-xl border border-border p-5">
          <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center"><Percent className="w-5 h-5 text-emerald-800" /></div><div><p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Commission Collected</p><p className="font-display font-black text-2xl text-emerald-950">{inr(totalCommission)}</p></div></div>
        </div>
        <div className="bg-white rounded-xl border border-border p-5">
          <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center"><Package className="w-5 h-5 text-emerald-700" /></div><div><p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Service Bookings</p><p className="font-display font-black text-2xl text-emerald-950">{totalServiceBookings}</p><p className="text-[11px] text-muted-foreground">Sales {inr(totalServiceSales)}</p></div></div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4" data-testid="selected-partner-admin-control">
        <p className="text-xs uppercase tracking-widest text-emerald-800 font-semibold">Direct Partner Control</p>
        <p className="text-xs text-muted-foreground mt-1">Pick one partner and run core admin actions directly from here.</p>
        <div className="mt-3 grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-3 items-end">
          <div>
            <Label>Selected Partner</Label>
            <select
              value={selectedPartnerId}
              onChange={(e) => setSelectedPartnerId(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
              data-testid="selected-partner-picker"
            >
              {partners.length === 0 ? (
                <option value="">No partners loaded</option>
              ) : (
                partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.business_name} ({p.partner_code})</option>
                ))
              )}
            </select>
          </div>
          <div className="flex justify-start lg:justify-end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="rounded-full" disabled={!selectedPartner} data-testid="selected-partner-action-trigger">
                  Selected Partner Actions <ChevronDown className="w-4 h-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem onClick={() => selectedPartner && openEdit(selectedPartner)} data-testid="quick-edit-partner">
                  <Pencil className="w-4 h-4 mr-2" /> Edit Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => selectedPartner && openLedger(selectedPartner)} data-testid="quick-ledger-partner">
                  <ScrollText className="w-4 h-4 mr-2" /> Sales / Commission
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => selectedPartner && downloadPartnerPdf(selectedPartner)} data-testid="quick-download-partner-pdf">
                  <FileDown className="w-4 h-4 mr-2" /> Download Partner PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => selectedPartner && sendPartnerMessage(selectedPartner)} data-testid="quick-message-partner">
                  <MessageCircle className="w-4 h-4 mr-2" /> Send Message
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => selectedPartner && (selectedPartner.active !== false ? deactivate(selectedPartner) : reactivate(selectedPartner))} data-testid="quick-toggle-partner">
                  {selectedPartner?.active !== false ? <Trash2 className="w-4 h-4 mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                  {selectedPartner?.active !== false ? "Deactive" : "Activate"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => selectedPartner && setDeleteTarget(selectedPartner)} className="text-red-700 focus:text-red-700" data-testid="quick-delete-partner">
                  <XCircle className="w-4 h-4 mr-2" /> Permanent Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4" data-testid="partner-nearby-offline-leads">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-widest text-emerald-800 font-semibold">Nearby Offline Leads</p>
            <p className="text-xs text-muted-foreground mt-1">External business/service/shop lead search (not from your listed partners).</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={useCityCenter}
              disabled={nearbyGeoBusy || !String(nearbyCity || "").trim()}
              variant="outline"
              className="rounded-full"
              data-testid="nearby-use-city-center"
            >
              {nearbyGeoBusy ? "Loading..." : "Use City Center"}
            </Button>
            <Button
              type="button"
              onClick={detectCurrentLocation}
              disabled={nearbyGeoBusy}
              className="rounded-full bg-emerald-900 hover:bg-emerald-950 text-white"
              data-testid="nearby-detect-location"
            >
              <LocateFixed className="w-4 h-4 mr-2" /> {nearbyGeoBusy ? "Detecting..." : "Use Current Location"}
            </Button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-2">
          <Input
            value={nearbyCity}
            onChange={(e) => setNearbyCity(e.target.value)}
            list="partner-city-list"
            placeholder="City"
            data-testid="nearby-city-filter"
          />
          <Input
            value={nearbyPincode}
            onChange={(e) => {
              const normalized = normalizePincode(e.target.value);
              setNearbyPincode(normalized);
              if (!isCompletePincode(normalized)) {
                lastNearbyPinRef.current = "";
              }
            }}
            placeholder="Pincode"
            maxLength={6}
            inputMode="numeric"
            data-testid="nearby-pincode-filter"
          />
          <Input
            value={nearbyType}
            onChange={(e) => setNearbyType(e.target.value)}
            list="partner-business-types-list"
            placeholder="Business/Service type"
            data-testid="nearby-type-filter"
          />
          <Input
            type="number"
            min={1}
            max={200}
            value={nearbyRadiusKm}
            onChange={(e) => setNearbyRadiusKm(e.target.value)}
            placeholder="Radius (km)"
            data-testid="nearby-radius-km"
          />
          <Button
            type="button"
            variant="outline"
            className="rounded-full"
            onClick={() => {
              setNearbyCity("");
              setNearbyPincode("");
              setNearbyType("");
              setNearbyRadiusKm(15);
              setNearbyLocation(null);
              setNearbyLocationLabel("");
              setNearbyLeads([]);
              setNearbySearched(false);
              setNearbySearchError("");
              lastNearbyPinRef.current = "";
            }}
            data-testid="nearby-clear-filters"
          >
            Clear
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={searchExternalLeads}
            disabled={nearbySearchBusy || !nearbyLocation}
            className="rounded-full bg-amber-500 hover:bg-amber-600 text-emerald-950"
            data-testid="nearby-search-external"
          >
            {nearbySearchBusy ? "Searching..." : "Search External Leads"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={exportExternalLeadsCsv}
            disabled={!nearbyLeads.length}
            className="rounded-full"
            data-testid="nearby-export-csv"
          >
            Export CSV
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => exportExternalLeadsCsv(true)}
            disabled={!dedupedRankedLeads.some((lead) => String(lead?.phone || "").trim())}
            className="rounded-full"
            data-testid="nearby-export-csv-phone-only"
          >
            Export Phone Leads Only
          </Button>
          <Button
            type="button"
            variant={dedupeEnabled ? "default" : "outline"}
            onClick={() => setDedupeEnabled((v) => !v)}
            className="rounded-full"
            data-testid="nearby-dedupe-toggle"
          >
            {dedupeEnabled ? "Duplicate Cleaner: ON" : "Duplicate Cleaner: OFF"}
          </Button>
          <Button
            type="button"
            variant={hotOnly ? "default" : "outline"}
            onClick={() => setHotOnly((v) => !v)}
            className="rounded-full"
            data-testid="nearby-hot-only-toggle"
          >
            {hotOnly ? "Hot Leads: ON" : "Show Only Hot Leads"}
          </Button>
          {nearbyLocationLabel ? <p className="text-xs text-slate-600">Search center: {nearbyLocationLabel}</p> : null}
        </div>

        {!nearbyLocation ? (
          <p className="text-xs text-amber-700 mt-3">আগে Current Location বা City Center set করুন।</p>
        ) : (
          <>
            <p className="text-xs text-slate-600 mt-3">
              Found <span className="font-semibold text-emerald-900">{visibleLeads.length}</span> external offline/website-missing leads within {Math.max(1, Number(nearbyRadiusKm) || 15)} km
            </p>
            {dedupedRankedLeads.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <span className="px-2 py-1 rounded-full bg-red-100 text-red-700 font-semibold">Hot: {scoreSummary.hot}</span>
                <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-800 font-semibold">Warm: {scoreSummary.warm}</span>
                <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700 font-semibold">Cold: {scoreSummary.cold}</span>
              </div>
            ) : null}
            {nearbySearchError ? <p className="text-xs text-red-600 mt-2">{nearbySearchError}</p> : null}
            {nearbySearched && visibleLeads.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-2">No matching leads in selected radius/filter.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-xs border border-border rounded-lg overflow-hidden" data-testid="nearby-leads-table">
                  <thead className="bg-slate-50 text-slate-700">
                    <tr>
                      <th className="text-left px-3 py-2">Shop</th>
                      <th className="text-left px-3 py-2">Type</th>
                      <th className="text-left px-3 py-2">City</th>
                      <th className="text-left px-3 py-2">Distance</th>
                      <th className="text-left px-3 py-2">Priority</th>
                      <th className="text-left px-3 py-2">Contact</th>
                      <th className="text-left px-3 py-2">Follow-up</th>
                      <th className="text-left px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLeads.slice(0, 200).map((p) => (
                      <tr key={`external-lead-${p.id}`} className="border-t border-border">
                        <td className="px-3 py-2">
                          <p className="font-semibold text-emerald-950">{p.business_name}</p>
                          <p className="text-[11px] text-slate-500">{p.address || "-"}</p>
                          {Number(p.duplicate_count || 1) > 1 ? (
                            <p className="text-[10px] text-amber-700 font-semibold">Merged duplicates: {p.duplicate_count}</p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">{p.business_type || "-"}</td>
                        <td className="px-3 py-2">{p.city || "-"}</td>
                        <td className="px-3 py-2">{Number(p.distance_km || 0).toFixed(1)} km</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1">
                            <span className={`px-2 py-0.5 rounded-full font-semibold ${p.priority_bucket === "Hot" ? "bg-red-100 text-red-700" : p.priority_bucket === "Warm" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}`}>
                              {p.priority_bucket}
                            </span>
                            <span className="text-[11px] text-slate-600">{p.lead_score}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {p.phone ? (
                            <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 text-emerald-800 hover:underline">
                              <PhoneCall className="w-3.5 h-3.5" /> {p.phone}
                            </a>
                          ) : (
                            <span className="text-slate-500">No phone</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={p.follow_up_status || "New"}
                            onChange={(e) => updateLeadFollowup(p.id, e.target.value)}
                            className="h-8 rounded-md border border-input px-2 bg-white text-slate-900"
                            data-testid={`lead-followup-${p.id}`}
                          >
                            {LEAD_FOLLOWUP_STATUSES.map((status) => (
                              <option key={status} value={status}>{status}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 font-semibold">
                              <Globe className="w-3 h-3" /> Website/Online Missing
                            </span>
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.business_name} ${p.address || ""}`)}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-800 hover:underline"
                            >
                              Open Map
                            </a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="partner-meta-admin-tools">
        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-xs uppercase tracking-widest text-emerald-800 font-semibold">Business / Services Category</p>
          <p className="text-xs text-muted-foreground mt-1">Partner form-এর Business Category dropdown/list এখানে control করুন।</p>
          <div className="mt-3 flex gap-2">
            <Input value={newBusinessType} onChange={(e) => setNewBusinessType(e.target.value)} placeholder="e.g. Electronics Store" data-testid="add-business-category-input" />
            <Button type="button" variant="outline" onClick={addBusinessType} data-testid="add-business-category-btn">Add</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {businessTypes.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => removeBusinessType(t)}
                className="text-xs px-2 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-900"
                title="Click to remove"
                data-testid={`business-category-chip-${t}`}
              >
                {t} ×
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <Button type="button" onClick={saveBusinessTypes} disabled={metaBusy} className="bg-emerald-900 hover:bg-emerald-950 text-white" data-testid="save-business-categories-btn">
              {metaBusy ? "Saving..." : "Save Categories"}
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-xs uppercase tracking-widest text-emerald-800 font-semibold">City List</p>
          <p className="text-xs text-muted-foreground mt-1">Partner form-এর city suggestion list এখানে add/remove করুন।</p>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <Label>Country</Label>
              <Input value="India" readOnly className="mt-1.5 h-11 bg-slate-50" data-testid="add-city-country" />
            </div>
            <div>
              <Label>State</Label>
              <select
                value={cityAdminState}
                onChange={(e) => {
                  setCityAdminState(e.target.value);
                  setCityAdminDistrict("");
                }}
                className="mt-1.5 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                data-testid="add-city-state"
              >
                {(indiaLocationMeta.states.length ? indiaLocationMeta.states : INDIAN_STATES).map((state) => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <Label>District</Label>
              <select
                value={cityAdminDistrict}
                onChange={(e) => setCityAdminDistrict(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                data-testid="add-city-district"
              >
                <option value="">Select district</option>
                {cityAdminDistrictOptions.map((district) => (
                  <option key={district} value={district}>{district}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <select
              value={newCity}
              onChange={(e) => setNewCity(e.target.value)}
              className="h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
              data-testid="add-city-select"
            >
              <option value="">Select city (auto)</option>
              {cityAdminAutoOptions.map((cityName) => (
                <option key={cityName} value={cityName}>{cityName}</option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex gap-2">
            <Input value={newCity} onChange={(e) => setNewCity(e.target.value)} placeholder="Manual city type করুন (e.g. Howrah)" data-testid="add-city-input" />
            <Button type="button" variant="outline" onClick={addCity} data-testid="add-city-btn">Add</Button>
          </div>
          {locationMetaBusy ? <p className="text-[11px] text-muted-foreground mt-2">India state/district/city list loading...</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {cities.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => removeCity(c)}
                className="text-xs px-2 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-900"
                title="Click to remove"
                data-testid={`city-chip-${c}`}
              >
                {c} ×
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <Button type="button" onClick={saveCities} disabled={metaBusy} className="bg-emerald-900 hover:bg-emerald-950 text-white" data-testid="save-cities-btn">
              {metaBusy ? "Saving..." : "Save Cities"}
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border p-4">
          <p className="text-xs uppercase tracking-widest text-emerald-800 font-semibold">Partner Message Templates</p>
          <p className="text-xs text-muted-foreground mt-1">Use placeholders: {"{business_name}"}, {"{contact_person}"}, {"{partner_code}"}, {"{city}"}, {"{business_type}"}, {"{phone}"}</p>
          <div className="mt-3 flex gap-2">
            <Input value={newMessageTemplate} onChange={(e) => setNewMessageTemplate(e.target.value)} placeholder="Template text with placeholders" data-testid="add-message-template-input" />
            <Button type="button" variant="outline" onClick={addMessageTemplate} data-testid="add-message-template-btn">Add</Button>
          </div>
          <div className="mt-3 max-h-40 overflow-auto space-y-2">
            {messageTemplates.map((t, idx) => (
              <button
                key={`${idx}-${t}`}
                type="button"
                onClick={() => removeMessageTemplate(t)}
                className="w-full text-left text-xs px-2 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900"
                title="Click to remove"
                data-testid={`message-template-chip-${idx}`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <Button type="button" onClick={saveMessageTemplates} disabled={templateBusy} className="bg-emerald-900 hover:bg-emerald-950 text-white" data-testid="save-message-templates-btn">
              {templateBusy ? "Saving..." : "Save Templates"}
            </Button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 border border-border rounded-full px-4 py-2 flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by shop name, city, category, phone, partner code"
              className="border-0 bg-transparent p-0 h-auto shadow-none focus-visible:ring-0"
              data-testid="partner-search-input"
            />
          </div>
          <Input
            value={cityFilter}
            onChange={(e) => setCityFilter(e.target.value)}
            placeholder="Filter city"
            list="partner-city-list"
            className="h-11 w-full md:w-56"
            data-testid="partner-city-filter"
          />
          <Input
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            placeholder="Business category"
            list="partner-business-types-list"
            className="h-11 w-full md:w-56"
            data-testid="partner-type-filter"
          />
          <Button type="button" variant="outline" className="rounded-full" onClick={() => { setSearch(""); setCityFilter(""); setTypeFilter(""); }} data-testid="clear-partner-filters">
            View All Partners
          </Button>
          <Button type="button" variant="outline" className="rounded-full" onClick={() => nav("/app/partner-approvals")} data-testid="open-partner-approvals">
            Partner Approvals
          </Button>
          <Button type="button" variant="outline" className="rounded-full" onClick={() => nav("/app/product-approvals")} data-testid="open-product-approvals">
            Product Approvals
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-emerald-800 font-semibold">Partner Admin List</p>
          <p className="text-sm text-slate-600">Row-wise actions: edit, active/deactive, permanent delete, approvals, sales/commission, message.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="rounded-full"
          onClick={() => setShowOfflineBilling((v) => !v)}
          data-testid="toggle-offline-billing-panel"
        >
          {showOfflineBilling ? "Hide Offline Billing" : "Show Offline Billing"}
        </Button>
      </div>

      {filteredPartners.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-10 text-center">
          <Store className="w-10 h-10 text-slate-400 mx-auto" />
          <p className="mt-3 text-emerald-950 font-semibold">কোনো partner found হয়নি।</p>
          <p className="text-sm text-muted-foreground mt-1">Search বা filters clear করে আবার দেখুন।</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPartners.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-border p-5" data-testid={`partner-${p.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[10px] uppercase tracking-widest text-emerald-800 font-semibold">{p.partner_code}</p>
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{p.business_type}</span>
                    {p.is_featured && <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-400 text-emerald-950 px-2 py-0.5 rounded-full flex items-center gap-1"><Star className="w-2.5 h-2.5 fill-emerald-950" />Featured</span>}
                    {p.active === false && <span className="text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Inactive</span>}
                  </div>
                  <p className="font-display font-black text-emerald-950 mt-1 text-lg">{p.business_name}</p>
                  <p className="text-xs text-muted-foreground font-body">
                    {p.contact_person} · {p.phone}{p.email ? ` · ${p.email}` : ""}
                  </p>
                  <p className="text-[11px] text-slate-500 font-body mt-1">
                    Reserve Wallet: <span className="font-semibold text-emerald-800">{inr(p.wallet?.balance || 0)}</span>
                    {p.pending_topup_requests > 0 && <span className="ml-2 text-amber-700 font-semibold">({p.pending_topup_requests} pending top-up)</span>}
                  </p>
                  {p.whatsapp_no && p.whatsapp_no !== p.phone && (
                    <p className="text-xs text-green-700 font-body flex items-center gap-1 mt-0.5"><MessageCircle className="w-3 h-3" /> WhatsApp: {p.whatsapp_no}</p>
                  )}
                  <p className="text-xs text-muted-foreground font-body mt-0.5">
                    {p.address}
                    {p.address ? (
                      <a href={mapsUrl(p)} target="_blank" rel="noreferrer" className="ml-2 text-emerald-700 hover:underline font-semibold">
                        Open Map
                      </a>
                    ) : null}
                  </p>
                  {p.gst_no && <p className="text-[11px] text-muted-foreground font-mono mt-0.5">GST: {p.gst_no}</p>}
                </div>
                <div className="text-right">
                  <div className="inline-flex items-center gap-2 bg-amber-100 text-amber-900 px-3 py-1.5 rounded-full font-display font-black">
                    <Percent className="w-3.5 h-3.5" />
                    {(p.agreement_percent ?? p.commission_percent)}% Agreement
                  </div>
                  <p className="text-[11px] text-muted-foreground font-body mt-2">
                    Sales: <span className="font-semibold text-emerald-800">{inr(p.total_sales || 0)}</span> ·
                    Commission: <span className="font-semibold text-emerald-800">{inr(p.total_commission_paid || 0)}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground font-body mt-1">
                    Service bookings: <span className="font-semibold text-emerald-800">{Number(p.service_booking_count || 0)}</span>
                    {" · "}Paid: <span className="font-semibold text-emerald-800">{Number(p.service_paid_booking_count || 0)}</span>
                    {" · "}Service sales: <span className="font-semibold text-emerald-800">{inr(Number(p.service_sales_total || 0))}</span>
                    {" · "}Transport trips: <span className="font-semibold text-emerald-800">{Number(p.transport_trip_count || 0)}</span>
                  </p>
                  {Array.isArray(p.service_categories) && p.service_categories.length > 0 ? (
                    <p className="text-[11px] text-slate-500 font-body mt-0.5">Service types: {p.service_categories.join(", ")}</p>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2 flex-wrap">
                <Button variant="outline" size="sm" className="rounded-full" onClick={() => openEdit(p)} data-testid={`partner-edit-${p.id}`}>
                  <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={`rounded-full ${p.active !== false ? "border-amber-300 text-amber-800 hover:bg-amber-50" : "border-emerald-300 text-emerald-800 hover:bg-emerald-50"}`}
                  onClick={() => (p.active !== false ? deactivate(p) : reactivate(p))}
                  data-testid={`partner-toggle-${p.id}`}
                >
                  {p.active !== false ? <Trash2 className="w-3.5 h-3.5 mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
                  {p.active !== false ? "Deactive" : "Activate"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full border-red-300 text-red-700 hover:bg-red-50"
                  onClick={() => setDeleteTarget(p)}
                  data-testid={`partner-delete-${p.id}`}
                >
                  <XCircle className="w-3.5 h-3.5 mr-1" /> Permanent Delete
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="rounded-full" data-testid={`partner-actions-${p.id}`}>
                      Partner Actions <ChevronDown className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuItem onClick={() => openEdit(p)}>
                      <Eye className="w-4 h-4 mr-2" /> View / Edit Profile
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => openLedger(p)}>
                      <ScrollText className="w-4 h-4 mr-2" /> View Sales / Commission
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => downloadPartnerPdf(p)}>
                      <FileDown className="w-4 h-4 mr-2" /> Download Partner PDF
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => nav("/app/partner-approvals")}>
                      <CheckCircle2 className="w-4 h-4 mr-2" /> Partner Applications
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => nav("/app/product-approvals")}>
                      <Package className="w-4 h-4 mr-2" /> Product Approvals
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => sendPartnerMessage(p)}>
                      <MessageCircle className="w-4 h-4 mr-2" /> Send Message (Template)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toggleFeatured(p)}>
                      <Star className="w-4 h-4 mr-2" /> {p.is_featured ? "Unfeature" : "Feature"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => (p.active !== false ? deactivate(p) : reactivate(p))}>
                      {p.active !== false ? <Trash2 className="w-4 h-4 mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                      {p.active !== false ? "Deactive" : "Activate"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDeleteTarget(p)} className="text-red-700 focus:text-red-700">
                      <XCircle className="w-4 h-4 mr-2" /> Permanent Delete
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={async () => {
                      if (!window.confirm(`Reset password for ${p.business_name}?`)) return;
                      try {
                        const { data } = await api.post(`/admin/partners/${p.id}/reset-password`);
                        window.prompt(`New password for ${data.user_email} (copy now — shown only once):`, data.new_password);
                        toast.success("Password reset — share securely");
                      } catch (err) {
                        toast.error(err?.response?.data?.detail || "Reset failed");
                      }
                    }}>
                      🔑 Reset Password
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to={`/gallery/${p.partner_code}`} target="_blank" className="flex items-center">
                        <Images className="w-4 h-4 mr-2" /> Open Gallery
                      </Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}

      {showOfflineBilling ? (
        <OfflineBillingPanel title="Admin Offline Billing" compact showPartnerScope />
      ) : null}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Partner Permanently Delete করুন</DialogTitle>
            <DialogDescription>
              <strong>{deleteTarget?.business_name}</strong> ({deleteTarget?.partner_code}) — এই কাজ undo করা যাবে না।
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
            সতর্কতা: Delete করলে partner এর সব data permanently মুছে যাবে।
            শুধু Block করতে চাইলে Delete এর বদলে Block ব্যবহার করুন।
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>Cancel</Button>
            <Button onClick={deletePartner} disabled={deleteBusy} className="bg-red-600 hover:bg-red-700 text-white" data-testid="delete-partner-confirm">
              {deleteBusy ? "Deleting..." : "Permanently Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create/Edit dialog */}
      <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.new ? "Register New Partner" : "Edit Partner"}</DialogTitle>
            <DialogDescription>Admin can update partner profile, commission %, password, active/block state, and visibility. Approval request rate is only the starting value.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="grid gap-3 md:grid-cols-2" data-testid="partner-form">
            <div className="md:col-span-2">
              <Label htmlFor="business_name">Business Name *</Label>
              <Input id="business_name" required value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} placeholder="e.g. Rahim General Store" data-testid="partner-name-input" className="mt-1.5 h-11" />
            </div>
            <div>
              <Label htmlFor="business_type">Business Category *</Label>
              <Input
                id="business_type"
                required
                list="partner-business-types-list"
                value={form.business_type}
                onChange={(e) => setForm({ ...form, business_type: e.target.value })}
                placeholder="Retail Shop"
                data-testid="partner-type-select"
                className="mt-1.5 h-11"
              />
              <datalist id="partner-business-types-list">
                {businessTypes.map((t) => <option key={t} value={t} />)}
              </datalist>
            </div>
            <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-3 md:col-span-1">
              <Label htmlFor="commission">Commission % *</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <Input
                  id="commission"
                  type="number"
                  min="0.1"
                  max="100"
                  step="0.1"
                  required
                  value={form.commission_percent}
                  onChange={(e) => setForm({ ...form, commission_percent: e.target.value })}
                  className="h-11 font-display font-black text-xl text-center flex-1"
                  data-testid="partner-commission-input"
                />
                <span className="font-display font-black text-2xl text-amber-700">%</span>
              </div>
              <p className="text-[11px] text-amber-900 mt-1 font-body">Admin এই partner-এর সব products-এর commission rate update করতে পারবে।</p>
            </div>
            <div>
              <Label htmlFor="contact">Contact Person *</Label>
              <Input id="contact" required value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} placeholder="Owner / Manager name" data-testid="partner-contact-input" className="mt-1.5 h-11" />
            </div>
            <div>
              <Label htmlFor="phone">Phone *</Label>
              <Input id="phone" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+91..." data-testid="partner-phone-input" className="mt-1.5 h-11" />
            </div>
            <div>
              <Label htmlFor="email">Partner Login ID *</Label>
              <Input id="email" required type="text" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email or phone" data-testid="partner-email-input" className="mt-1.5 h-11" />
            </div>
            <div>
              <Label htmlFor="password">Partner Password {editing?.new ? "*" : "(optional)"}</Label>
              <Input id="password" type="text" value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editing?.new ? "min 6 chars" : "leave blank to keep current"} data-testid="partner-password-input" className="mt-1.5 h-11 font-mono" required={!!editing?.new} minLength={editing?.new ? 6 : undefined} />
            </div>
            <div>
              <Label htmlFor="gst">GST Number</Label>
              <Input id="gst" value={form.gst_no} onChange={(e) => setForm({ ...form, gst_no: e.target.value })} placeholder="Optional (registered businesses)" data-testid="partner-gst-input" className="mt-1.5 h-11 font-mono" />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="address">Address *</Label>
              <Textarea id="address" required value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Full address with pincode" data-testid="partner-address-input" className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="city">City</Label>
              <Input id="city" list="partner-city-list" value={form.city || ""} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" data-testid="partner-city-input" className="mt-1.5 h-11" />
              <datalist id="partner-city-list">
                {cities.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <Label htmlFor="state">State</Label>
              <Input id="state" list="partner-state-list" value={form.state || ""} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="Select or type state" data-testid="partner-state-input" className="mt-1.5 h-11" />
              <datalist id="partner-state-list">
                {INDIAN_STATES.map((state) => <option key={state} value={state} />)}
              </datalist>
            </div>
            <div>
              <Label htmlFor="pincode">Pincode</Label>
              <Input
                id="pincode"
                value={form.pincode || ""}
                onChange={(e) => setForm({ ...form, pincode: normalizePincode(e.target.value) })}
                onBlur={() => lookupPincodeAndApply(form.pincode, setForm, lastFormPinRef)}
                placeholder="Pincode"
                data-testid="partner-pincode-input"
                className="mt-1.5 h-11"
              />
              {partnerPincodeBusy ? <p className="text-[11px] text-muted-foreground mt-1">Pincode থেকে city আনা হচ্ছে...</p> : null}
            </div>
            <div>
              <Label htmlFor="upi">Partner UPI (for reference)</Label>
              <Input id="upi" value={form.upi_id} onChange={(e) => setForm({ ...form, upi_id: e.target.value })} placeholder="rahimshop@paytm" data-testid="partner-upi-input" className="mt-1.5 h-11 font-mono" />
            </div>
            <div>
              <Label htmlFor="whatsapp">WhatsApp No <span className="text-slate-400 text-xs">(if different from phone)</span></Label>
              <Input id="whatsapp" value={form.whatsapp_no} onChange={(e) => setForm({ ...form, whatsapp_no: e.target.value })} placeholder="+91... (blank = same as phone)" data-testid="partner-whatsapp-input" className="mt-1.5 h-11" />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} data-testid="partner-active-toggle" className="w-4 h-4" />
                Active — new sales apply commission
              </label>
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Agreement terms, prime location, etc." data-testid="partner-notes-input" className="mt-1.5" />
            </div>
            <DialogFooter className="md:col-span-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={busy} className="bg-emerald-900 hover:bg-emerald-950 text-white" data-testid="partner-save-button">
                {busy ? "Saving..." : (editing?.new ? "Register Partner" : "Save Changes")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!ledger} onOpenChange={() => setLedger(null)}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Partner Ledger — {ledger?.partner?.business_name}</DialogTitle>
            <DialogDescription>All sales & commission entries for this partner. Export to Excel for accounting.</DialogDescription>
          </DialogHeader>
          {ledger && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-emerald-50 p-3 rounded-lg"><p className="text-[10px] uppercase text-emerald-800 font-bold">Total Sales</p><p className="font-display font-black text-xl text-emerald-950">{inr(ledger.partner.total_sales)}</p></div>
                <div className="bg-amber-50 p-3 rounded-lg"><p className="text-[10px] uppercase text-amber-800 font-bold">Agreement %</p><p className="font-display font-black text-xl text-emerald-950">{(ledger.partner.agreement_percent ?? ledger.partner.commission_percent)}%</p></div>
                <div className="bg-emerald-900 text-white p-3 rounded-lg"><p className="text-[10px] uppercase text-amber-400 font-bold">Commission Collected</p><p className="font-display font-black text-xl">{inr(ledger.partner.total_commission_paid)}</p></div>
              </div>
              <div className="flex justify-end">
                <Button onClick={exportLedgerExcel} variant="outline" className="rounded-full border-emerald-800 text-emerald-900" data-testid="export-ledger-excel">
                  <FileSpreadsheet className="w-4 h-4 mr-2" /> Export Excel
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/40 text-left">
                    <tr>
                      <th className="px-3 py-2 font-semibold text-slate-700 text-xs uppercase">Date</th>
                      <th className="px-3 py-2 font-semibold text-slate-700 text-xs uppercase">Period</th>
                      <th className="px-3 py-2 font-semibold text-slate-700 text-xs uppercase text-right">Sales</th>
                      <th className="px-3 py-2 font-semibold text-slate-700 text-xs uppercase text-right">Rate %</th>
                      <th className="px-3 py-2 font-semibold text-slate-700 text-xs uppercase text-right">Commission</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ledger.entries.length === 0 ? (
                      <tr><td colSpan="5" className="px-3 py-6 text-center text-muted-foreground">No entries yet.</td></tr>
                    ) : ledger.entries.map((e, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 text-xs">{new Date(e.created_at).toLocaleString()}</td>
                        <td className="px-3 py-2 font-mono text-xs">{e.period}</td>
                        <td className="text-right px-3 py-2">{inr(e.sales_amount)}</td>
                        <td className="text-right px-3 py-2 text-xs">{e.commission_percent}%</td>
                        <td className="text-right px-3 py-2 font-semibold text-emerald-800">{inr(e.commission_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Partner Top-up Requests */}
      <Dialog open={!!topupPartner} onOpenChange={(o) => { if (!o) { setTopupPartner(null); setTopupRequests([]); } }}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Top-up Requests — {topupPartner?.business_name}</DialogTitle>
            <DialogDescription>
              Partner wallet recharge request approve করলে invoice approval-এর commission reserve auto কাজ করবে।
            </DialogDescription>
          </DialogHeader>
          {topupRequests.length === 0 ? (
            <p className="text-sm text-slate-500">No pending top-up requests.</p>
          ) : (
            <div className="space-y-3">
              {topupRequests.map((req) => (
                <div key={req.id} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{new Date(req.created_at).toLocaleString()}</p>
                      <p className="font-display font-black text-emerald-950 text-xl">{inr(req.amount)}</p>
                      <p className="text-xs text-slate-600 font-mono">Txn: {req.txn_id}</p>
                    </div>
                    {req.proof_url ? (
                      <a href={resolveAssetUrl(req.proof_url)} target="_blank" rel="noreferrer">
                        <img
                          src={resolveAssetUrl(req.proof_url)}
                          alt="Top-up proof"
                          className="w-20 h-20 object-cover rounded-lg border border-border"
                          loading="lazy"
                          decoding="async"
                        />
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <Button size="sm" onClick={() => approveTopup(req.id)} disabled={topupBusy} className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-full" data-testid={`approve-topup-${req.id}`}>
                      <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => rejectTopup(req.id)} disabled={topupBusy} className="rounded-full border-red-300 text-red-700 hover:bg-red-50" data-testid={`reject-topup-${req.id}`}>
                      <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!messageTarget} onOpenChange={(o) => { if (!o) setMessageTarget(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Send Message — {messageTarget?.business_name}</DialogTitle>
            <DialogDescription>Choose a saved template, adjust the final message, then open WhatsApp.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Template</Label>
              <select
                value={messageTemplateIndex}
                onChange={(e) => applyTemplateToDraft(Number(e.target.value || 0))}
                className="mt-1.5 h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                data-testid="partner-message-template-select"
              >
                {messageTemplates.map((t, idx) => (
                  <option key={`${idx}-${t}`} value={idx}>{`Template ${idx + 1}`}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Message</Label>
              <Textarea
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                className="mt-1.5 min-h-28"
                data-testid="partner-message-draft"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMessageTarget(null)}>Cancel</Button>
            <Button type="button" onClick={openWhatsappWithDraft} className="bg-emerald-900 hover:bg-emerald-950 text-white" data-testid="partner-message-send-btn">
              Send via WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

