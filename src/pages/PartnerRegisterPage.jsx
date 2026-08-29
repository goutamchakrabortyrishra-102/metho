import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Store, Send, CheckCircle2, Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import api from "@/services/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Logo } from "@/components/Logo";
import { INDIAN_STATES, isCompletePincode, normalizePincode } from "@/lib/indiaLocation";

const BUSINESS_TYPES = ["Shop", "Service"];
const LOCAL_CITIES_KEY = "metho_admin_cities_v1";

const SERVICE_CATEGORY_OPTIONS = [
  "Hotel",
  "Homestay",
  "Doctor Clinic",
  "Dental",
  "Diagnostic Center",
  "Restaurant",
  "Cafe",
  "Salon",
  "Spa",
  "Fitness",
  "Education",
  "Home Service",
  "Laundry",
  "Tailoring",
  "Beauty at Home",
  "Photography",
  "Singing & Music",
  "Poetry & Recitation",
  "Dance & Performing Arts",
  "Recording Studio",
  "Transport",
  "Travel Agency",
  "Courier",
  "Logistics",
  "Cleaning",
  "Security",
  "Real Estate",
  "Legal",
  "Accounting",
  "Repair Center",
  "Internet Service",
  "Printing",
  "Other Service",
];

const SERVICE_SECTOR_OPTIONS = [
  "Transport",
  "Delivery Partner",
  "Stay & Dining",
  "Property Buy & Sell",
  "Doorstep",
  "Other Services",
  "Creative & Media",
];

const SHOP_SECTOR_OPTIONS = [
  "Vegetables",
  "Grocery",
  "Cosmetics & Beauty",
  "Others",
];

const SERVICE_TEMPLATE_OPTIONS_BY_SECTOR = {
  Transport: ["Cab", "Car Rental", "Bike Rental", "Travel Agency"],
  "Delivery Partner": ["Courier", "Logistics", "Cargo", "Parcel", "Express Delivery", "Pickup & Drop"],
  "Stay & Dining": ["Hotel", "Homestay", "Restaurant", "Cafe", "Banquet", "House Rent", "Flat Rent", "Shop Rent", "Apartment Rent", "Event Venue Rental", "Resort Rental", "Hall Rental"],
  "Property Buy & Sell": ["Property Sale", "Flat Sale", "House Sale", "Shop Sale", "Plot Sale", "Commercial Property", "Property Broker", "Site Visit"],
  Doorstep: ["Home Service", "Laundry", "Cleaning", "Tailoring", "Beauty at Home", "Repair Center"],
  "Other Services": ["Doctor Clinic", "Diagnostic Center", "Education", "Fitness", "Legal", "Accounting", "Photography", "Internet Service", "Other Service"],
  "Creative & Media": ["Singing Classes", "Poetry & Recitation", "Dance Classes", "Music Recording", "Acting & Audition", "Instrument Training", "Studio Booking"],
};

const SHOP_TEMPLATE_OPTIONS_BY_SECTOR = {
  Vegetables: ["Fresh Vegetable", "Leafy Greens", "Seasonal Produce", "Root Vegetables"],
  Grocery: ["Kirana Essentials", "Rice & Dal", "Spices & Masala", "Oil & Pantry"],
  "Cosmetics & Beauty": ["Skincare", "Makeup", "Hair Care", "Personal Care"],
  Others: ["Household", "Stationery", "Fashion", "General Store", "Car Sale", "Vehicle Sale", "Bike Sale"],
};

const TRANSPORT_REG_HINTS = [
  "transport", "cab", "taxi", "car", "car rental", "bike", "bike rental", "duchaka", "truck", "lorry", "travel", "vehicle",
];
const DELIVERY_REG_HINTS = [
  "delivery", "courier", "logistics", "cargo", "parcel", "shipment", "dispatch", "freight", "goods carrier", "pickup drop", "pickup and drop",
];
const STAY_DINING_REG_HINTS = [
  "hotel", "homestay", "home stay", "guest house", "resort", "restaurant", "resturent", "cafe", "dining", "sitbooking", "seat booking", "banquet", "rental house", "stay", "house rent", "flat rent", "shop rent", "apartment rent", "anusthan bari", "anusthanbari", "event venue rental", "resort rental", "hall rental", "resort vara", "resort bhara", "hall vara", "hall bhara", "wedding hall", "event hall",
];
const PROPERTY_REG_HINTS = [
  "property", "real estate", "realestate", "buy sell", "buy & sell", "plot sale", "flat sale", "house sale", "shop sale", "commercial property", "property broker", "broker", "brokerage", "site visit", "resale", "land", "jomi", "jami", "bari bikri", "flat bikri",
];
const DOORSTEP_REG_HINTS = [
  "doorstep", "mistri", "mechanic", "plumber", "plumbing", "electrician", "repair", "cleaning", "laundry", "tailoring", "beauty at home", "home service",
];
const CREATIVE_REG_HINTS = [
  "singing", "music", "song", "poetry", "recitation", "kobita", "abritti", "dance", "dancing", "performing arts", "recording", "studio", "acting", "audition", "instrument", "creative", "media",
];
const SHOP_REG_HINTS = [
  "shop", "store", "mart", "grocery", "vegetable", "cosmetics", "beauty", "product", "retail", "kirana", "pharmacy",
];
const VEHICLE_SALE_REG_HINTS = ["car sale", "car sell", "used car", "vehicle sale", "vehicle sell", "bike sale", "bike sell", "auto sale", "truck sale", "lorry sale"];

const normalizeText = (value) => String(value || "").trim().toLowerCase();
const includesAnyHint = (text, hints) => hints.some((hint) => text.includes(hint));

const inferRegistrationSelection = (form) => {
  const combinedText = [
    form.business_name,
    form.business_description,
    form.service_category,
    form.shop_category,
  ].map(normalizeText).join(" ");

  const looksTransport = includesAnyHint(combinedText, TRANSPORT_REG_HINTS);
  const looksDelivery = includesAnyHint(combinedText, DELIVERY_REG_HINTS);
  const looksStayDining = includesAnyHint(combinedText, STAY_DINING_REG_HINTS);
  const looksProperty = includesAnyHint(combinedText, PROPERTY_REG_HINTS);
  const looksDoorstep = includesAnyHint(combinedText, DOORSTEP_REG_HINTS);
  const looksCreative = includesAnyHint(combinedText, CREATIVE_REG_HINTS);
  const looksShop = includesAnyHint(combinedText, SHOP_REG_HINTS);
  const looksVehicleSale = includesAnyHint(combinedText, VEHICLE_SALE_REG_HINTS);

  const inferredBusinessType = looksVehicleSale ? "Shop" : (looksDelivery || looksTransport || looksStayDining || looksProperty || looksDoorstep || looksCreative)
    ? "Service"
    : (looksShop ? "Shop" : String(form.business_type || "Shop"));

  let inferredServiceSector = String(form.service_sector || "");
  if (inferredBusinessType === "Service") {
    if (looksDelivery) inferredServiceSector = "Delivery Partner";
    else if (looksTransport) inferredServiceSector = "Transport";
    else if (looksProperty) inferredServiceSector = "Property Buy & Sell";
    else if (looksStayDining) inferredServiceSector = "Stay & Dining";
    else if (looksDoorstep) inferredServiceSector = "Doorstep";
    else if (looksCreative) inferredServiceSector = "Creative & Media";
    else inferredServiceSector = inferredServiceSector || "Other Services";
  }

  let inferredShopSector = String(form.shop_sector || "");
  if (inferredBusinessType === "Shop") {
    if (combinedText.includes("vegetable")) inferredShopSector = "Vegetables";
    else if (combinedText.includes("grocery") || combinedText.includes("kirana")) inferredShopSector = "Grocery";
    else if (combinedText.includes("cosmetic") || combinedText.includes("beauty")) inferredShopSector = "Cosmetics & Beauty";
    else inferredShopSector = inferredShopSector || "Others";
  }

  return {
    business_type: inferredBusinessType,
    service_sector: inferredServiceSector,
    shop_sector: inferredShopSector,
  };
};

const normalizeAddressForSearch = ({ address, city, district, state, pincode }) => {
  const base = String(address || "").trim();
  const tail = [city, district, state, pincode]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
  if (!tail.length) return base;
  if (!base) return tail.join(", ");

  const lowerBase = base.toLowerCase();
  const missingTail = tail.filter((part) => !lowerBase.includes(part.toLowerCase()));
  if (!missingTail.length) return base;
  return `${base}, ${missingTail.join(", ")}`;
};

const uniqueSorted = (items) => Array.from(new Set(items.map((value) => String(value || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));

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
    // ignore local storage failures
  }
};

const mergeUniqueInOrder = (...lists) => {
  const seen = new Set();
  const out = [];
  lists.forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((item) => {
      const value = String(item || "").trim();
      const key = value.toLowerCase();
      if (!value || seen.has(key)) return;
      seen.add(key);
      out.push(value);
    });
  });
  return out;
};

const normalizeRegistrationCustomOptions = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const normalizeMap = (obj) => {
    const out = {};
    const entries = obj && typeof obj === "object" ? Object.entries(obj) : [];
    entries.forEach(([key, list]) => {
      const sector = String(key || "").trim();
      if (!sector) return;
      const merged = mergeUniqueInOrder(list);
      if (merged.length) out[sector] = merged;
    });
    return out;
  };
  return {
    service_sectors: mergeUniqueInOrder(source.service_sectors),
    shop_sectors: mergeUniqueInOrder(source.shop_sectors),
    service_templates_by_sector: normalizeMap(source.service_templates_by_sector),
    shop_templates_by_sector: normalizeMap(source.shop_templates_by_sector),
  };
};

const DEFAULT_REGISTRATION_CUSTOM_OPTIONS = {
  service_sectors: [],
  shop_sectors: [],
  service_templates_by_sector: {},
  shop_templates_by_sector: {},
};

export default function PartnerRegisterPage() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    business_name: "", business_type: "Shop",
    contact_person: "", phone: "", dob: "", email: "", password: "", whatsapp_no: "",
    address: "", city: "", district: "", state: "", pincode: "",
    gst_no: "", pan_no: "", aadhaar_no: "", upi_id: "", website: "", social_link: "",
    business_description: "", commission_percent_ask: "", service_sector: "", service_category: "", shop_sector: "", shop_category: "",
  });
  const [busy, setBusy] = useState(false);
  const [pincodeBusy, setPincodeBusy] = useState(false);
  const [locationMetaBusy, setLocationMetaBusy] = useState(false);
  const [indiaLocationMeta, setIndiaLocationMeta] = useState({
    states: [],
    districtsByState: {},
    citiesByStateDistrict: {},
  });
  const [cityOptions, setCityOptions] = useState([]);
  const [districtOptions, setDistrictOptions] = useState([]);
  const lastLookupPinRef = useRef("");
  const [done, setDone] = useState(null);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [registrationCustomOptions, setRegistrationCustomOptions] = useState(DEFAULT_REGISTRATION_CUSTOM_OPTIONS);
  const isShop = form.business_type === "Shop";
  const isService = form.business_type === "Service";
  const serviceSectorOptions = useMemo(
    () => mergeUniqueInOrder(SERVICE_SECTOR_OPTIONS, registrationCustomOptions.service_sectors),
    [registrationCustomOptions.service_sectors]
  );
  const shopSectorOptions = useMemo(
    () => mergeUniqueInOrder(SHOP_SECTOR_OPTIONS, registrationCustomOptions.shop_sectors),
    [registrationCustomOptions.shop_sectors]
  );
  const serviceTemplateOptionsBySector = useMemo(() => {
    const keys = mergeUniqueInOrder(Object.keys(SERVICE_TEMPLATE_OPTIONS_BY_SECTOR), Object.keys(registrationCustomOptions.service_templates_by_sector), serviceSectorOptions);
    const out = {};
    keys.forEach((sector) => {
      out[sector] = mergeUniqueInOrder(SERVICE_TEMPLATE_OPTIONS_BY_SECTOR[sector] || [], registrationCustomOptions.service_templates_by_sector[sector] || []);
    });
    return out;
  }, [registrationCustomOptions.service_templates_by_sector, serviceSectorOptions]);
  const shopTemplateOptionsBySector = useMemo(() => {
    const keys = mergeUniqueInOrder(Object.keys(SHOP_TEMPLATE_OPTIONS_BY_SECTOR), Object.keys(registrationCustomOptions.shop_templates_by_sector), shopSectorOptions);
    const out = {};
    keys.forEach((sector) => {
      out[sector] = mergeUniqueInOrder(SHOP_TEMPLATE_OPTIONS_BY_SECTOR[sector] || [], registrationCustomOptions.shop_templates_by_sector[sector] || []);
    });
    return out;
  }, [registrationCustomOptions.shop_templates_by_sector, shopSectorOptions]);
  const allServiceTemplateOptions = useMemo(
    () => mergeUniqueInOrder(SERVICE_CATEGORY_OPTIONS, ...Object.values(serviceTemplateOptionsBySector)),
    [serviceTemplateOptionsBySector]
  );
  const allShopTemplateOptions = useMemo(
    () => mergeUniqueInOrder(...Object.values(shopTemplateOptionsBySector)),
    [shopTemplateOptionsBySector]
  );
  const isVegetableShop = isShop && String(form.shop_sector || "").trim().toLowerCase() === "vegetables";
  const suggestedServiceTemplates = isService
    ? (serviceTemplateOptionsBySector[form.service_sector] || allServiceTemplateOptions)
    : [];
  const suggestedShopTemplates = isShop
    ? (shopTemplateOptionsBySector[form.shop_sector] || allShopTemplateOptions)
    : [];
  const selectedDistrictOptions = useMemo(() => {
    const fromPin = districtOptions || [];
    const fromMeta = form.state ? (indiaLocationMeta.districtsByState?.[form.state] || []) : [];
    return uniqueSorted([...(fromPin || []), ...(fromMeta || []), form.district]);
  }, [districtOptions, form.district, form.state, indiaLocationMeta.districtsByState]);

  const selectedCityOptions = useMemo(() => {
    if (!form.state || !form.district) {
      return uniqueSorted([...(cityOptions || []), form.city]);
    }
    const key = `${String(form.state || "").toLowerCase()}||${String(form.district || "").toLowerCase()}`;
    const fromMeta = indiaLocationMeta.citiesByStateDistrict?.[key] || [];
    return uniqueSorted([...(cityOptions || []), ...(fromMeta || []), form.city]);
  }, [cityOptions, form.city, form.state, form.district, indiaLocationMeta.citiesByStateDistrict]);

  const upd = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const inferenceInput = useMemo(() => ({
    business_name: form.business_name,
    business_description: form.business_description,
    service_category: form.service_category,
    shop_category: form.shop_category,
    business_type: form.business_type,
    service_sector: form.service_sector,
    shop_sector: form.shop_sector,
  }), [
    form.business_name,
    form.business_description,
    form.service_category,
    form.shop_category,
    form.business_type,
    form.service_sector,
    form.shop_sector,
  ]);

  useEffect(() => {
    const inferred = inferRegistrationSelection(inferenceInput);
    setForm((prev) => {
      const shouldUpdate =
        inferred.business_type !== prev.business_type ||
        (inferred.business_type === "Service" && inferred.service_sector !== prev.service_sector) ||
        (inferred.business_type === "Shop" && inferred.shop_sector !== prev.shop_sector);

      if (!shouldUpdate) return prev;
      return {
        ...prev,
        business_type: inferred.business_type,
        service_sector: inferred.business_type === "Service" ? inferred.service_sector : "",
        shop_sector: inferred.business_type === "Shop" ? inferred.shop_sector : "",
      };
    });
  }, [inferenceInput]);

  useEffect(() => {
    let cancelled = false;
    api.get("/settings/public")
      .then((r) => {
        if (cancelled) return;
        const next = normalizeRegistrationCustomOptions(r?.data?.partner_registration_custom_options);
        setRegistrationCustomOptions(next);
      })
      .catch(() => {
        if (!cancelled) setRegistrationCustomOptions(DEFAULT_REGISTRATION_CUSTOM_OPTIONS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api.get("/directory/cities")
      .then((r) => {
        if (cancelled) return;
        const apiCities = Array.isArray(r.data) ? r.data : [];
        if (apiCities.length) {
          setCityOptions(apiCities);
          writeLocalArray(LOCAL_CITIES_KEY, apiCities);
          return;
        }

        const cached = readLocalArray(LOCAL_CITIES_KEY, []);
        if (cached.length) setCityOptions(cached);
      })
      .catch(() => {
        if (cancelled) return;
        const cached = readLocalArray(LOCAL_CITIES_KEY, []);
        if (cached.length) {
          setCityOptions(cached);
          return;
        }
        setCityOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let idleId = null;
    let timerId = null;
    setLocationMetaBusy(true);

    const loadLocationMeta = () => {
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

    // Defer this heavy dataset load to idle time so it never blocks the page's first paint.
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(loadLocationMeta, { timeout: 2000 });
    } else {
      timerId = window.setTimeout(loadLocationMeta, 450);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleId);
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, []);

  useEffect(() => {
    const pin = normalizePincode(form.pincode);
    if (!isCompletePincode(pin)) return;
    if (lastLookupPinRef.current === pin) return;

    let cancelled = false;
    setPincodeBusy(true);
    api
      .get(`/directory/pincode-lookup?pincode=${encodeURIComponent(pin)}`)
      .then((r) => {
        if (cancelled) return;
        const city = String(r?.data?.city || "").trim();
        const cityOptionsFromPin = Array.isArray(r?.data?.city_options) ? r.data.city_options : [];
        const state = String(r?.data?.state || "").trim();
        setDistrictOptions(cityOptionsFromPin);
        if (cityOptionsFromPin.length || city) {
          setCityOptions((prev) => {
            const merged = uniqueSorted([...(prev || []), ...cityOptionsFromPin, city]);
            writeLocalArray(LOCAL_CITIES_KEY, merged);
            return merged;
          });
        }
        setForm((prev) => ({
          ...prev,
          pincode: pin,
          city: city || prev.city,
          district: cityOptionsFromPin[0] || prev.district,
          state: state || prev.state,
        }));
        lastLookupPinRef.current = pin;
      })
      .catch(() => {
        if (!cancelled) {
          setDistrictOptions([]);
          toast.error("Pincode থেকে location খুঁজে পাওয়া যায়নি");
        }
      })
      .finally(() => {
        if (!cancelled) setPincodeBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [form.pincode]);

  const submit = async (e) => {
    e.preventDefault();
    if (!agreedToTerms) {
      return toast.error("Please read and accept Terms & Conditions before submitting");
    }
    if (!form.business_name || !form.contact_person || !form.phone || !form.email || !form.password || !form.address || !form.city || !form.state || !form.pan_no || !form.aadhaar_no) {
      return toast.error("Please fill all required fields");
    }
    const pan = String(form.pan_no || "").trim().toUpperCase();
    const aadhaar = String(form.aadhaar_no || "").replace(/\D/g, "");
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
      return toast.error("Please enter a valid PAN number");
    }
    if (!/^\d{12}$/.test(aadhaar)) {
      return toast.error("Please enter a valid 12-digit Aadhaar number");
    }
    if (String(form.password || "").length < 6) {
      return toast.error("Password must be at least 6 characters");
    }
    if (isService && !String(form.service_sector || "").trim()) {
      return toast.error("Please select service sector");
    }
    if (isShop && !String(form.shop_sector || "").trim()) {
      return toast.error("Please select shop sector");
    }
    setBusy(true);
    try {
      const payload = {
        ...form,
        address: normalizeAddressForSearch({
          address: form.address,
          city: form.city,
          district: form.district,
          state: form.state,
          pincode: form.pincode,
        }),
        pan_no: pan,
        aadhaar_no: aadhaar,
        // Keep legacy key so backend uniqueness checks remain consistent.
        gst_no: pan,
      };
      if (payload.commission_percent_ask === "") delete payload.commission_percent_ask;
      else payload.commission_percent_ask = Number(payload.commission_percent_ask);
      if (!isService) {
        delete payload.service_sector;
        delete payload.service_category;
      }
      if (!isShop) {
        delete payload.shop_sector;
        delete payload.shop_category;
      }
      const { data } = await api.post("/partners/register", payload);
      setDone(data);
      toast.success("Application submitted!");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Submission failed");
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl border-2 border-emerald-300 p-8 text-center shadow-xl" data-testid="partner-register-success">
          <div className="w-16 h-16 mx-auto rounded-full bg-emerald-100 flex items-center justify-center">
            <CheckCircle2 className="w-9 h-9 text-emerald-700" />
          </div>
          <h1 className="mt-4 font-display font-black text-2xl text-emerald-950">Application Received!</h1>
          <p className="mt-3 text-slate-600 font-body text-sm">{done.message}</p>
          <p className="mt-4 text-xs bg-emerald-50 border border-emerald-200 rounded-lg p-3 font-mono text-emerald-800">
            Reference ID: {done.request_id?.slice(0, 8)}
          </p>
          <p className="mt-4 text-xs text-slate-500 font-body">
            Once approved by admin, sign in using the username and password you set in this form.
          </p>
          {isVegetableShop ? (
            <Link to="/partner-shop/MTH-PARTNER-004" className="mt-6 inline-block">
              <Button className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full">Open Metho Vegetable Public Page</Button>
            </Link>
          ) : (
            <Link to="/directory" className="mt-6 inline-block">
              <Button className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full">View All Partners/Services</Button>
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50" data-testid="partner-register-page">
      <header className="bg-emerald-950 text-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Logo />
          <Link to="/directory" className="text-sm text-white/80 hover:text-amber-400 flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Explore Partners
          </Link>
        </div>
      </header>

      <div className="bg-gradient-to-br from-emerald-950 to-emerald-800 text-white">
        <div className="max-w-4xl mx-auto px-4 py-10 md:py-14">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/20 text-xs font-semibold">
            <Store className="w-3.5 h-3.5" /> Become a METHO Associate Partner
          </div>
          <h1 className="mt-4 font-display font-black text-3xl md:text-5xl leading-tight tracking-tight">
            Register your <span className="text-amber-400">Shop or Service</span> with METHO
          </h1>
          <p className="mt-3 text-emerald-100/85 font-body max-w-2xl">
            Choose only one sector: Shop or Service.
            One mobile number and one PAN can be used for only one partner registration.
            After admin approval, your partner login activates with your chosen username and password.
          </p>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <form onSubmit={submit} className="bg-white rounded-2xl border border-border p-6 md:p-8 space-y-6" data-testid="partner-register-form">

          <section>
            <h2 className="font-display font-black text-lg text-emerald-950">Business Details</h2>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div className="md:col-span-2">
                <Label>{isService ? "Service Name *" : "Shop Name *"}</Label>
                <Input required value={form.business_name} onChange={upd("business_name")} placeholder={isService ? "e.g. City Care Diagnostics" : "e.g. Sharma Kirana Store"} className="mt-1.5 h-11" data-testid="reg-business-name" />
              </div>
              <div>
                <Label>Sector *</Label>
                <select
                  required
                  value={form.business_type}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    setForm((prev) => ({
                      ...prev,
                      business_type: nextType,
                      service_sector: nextType === "Service" ? (prev.service_sector || "Other Services") : "",
                      service_category: nextType === "Service" ? (prev.service_category || "") : "",
                      shop_sector: nextType === "Shop" ? (prev.shop_sector || "Others") : "",
                      shop_category: nextType === "Shop" ? (prev.shop_category || "") : "",
                    }));
                  }}
                  className="mt-1.5 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                  data-testid="reg-business-type"
                >
                  {BUSINESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {isService ? (
                <div className="space-y-3">
                  <div>
                    <Label>Primary Service Sector *</Label>
                    <select
                      required={isService}
                      value={form.service_sector || ""}
                      onChange={upd("service_sector")}
                      className="mt-1.5 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                      data-testid="reg-service-sector"
                    >
                      <option value="">Select service sector</option>
                      {serviceSectorOptions.map((sector) => (
                        <option key={sector} value={sector}>{sector}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Service Template / Category</Label>
                    <Input
                      list="service-template-options"
                      value={form.service_category || ""}
                      onChange={upd("service_category")}
                      placeholder="Select from template or type your own"
                      className="mt-1.5 h-11"
                      data-testid="reg-service-category"
                    />
                    <datalist id="service-template-options">
                      {suggestedServiceTemplates.map((category) => (
                        <option key={category} value={category} />
                      ))}
                    </datalist>
                    <p className="text-[11px] text-muted-foreground mt-1">Dropdown থেকে নিতে পারবেন, বা নিজে type করেও দিতে পারবেন।</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {suggestedServiceTemplates.slice(0, 8).map((template) => (
                        <button
                          key={template}
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, service_category: template }))}
                          className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100"
                        >
                          {template}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <Label>Primary Shop Sector *</Label>
                    <select
                      required={isShop}
                      value={form.shop_sector || ""}
                      onChange={upd("shop_sector")}
                      className="mt-1.5 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                      data-testid="reg-shop-sector"
                    >
                      <option value="">Select shop sector</option>
                      {shopSectorOptions.map((sector) => (
                        <option key={sector} value={sector}>{sector}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Shop Template / Category</Label>
                    <Input
                      list="shop-template-options"
                      value={form.shop_category || ""}
                      onChange={upd("shop_category")}
                      placeholder="Select from template or type your own"
                      className="mt-1.5 h-11"
                      data-testid="reg-shop-category"
                    />
                    <datalist id="shop-template-options">
                      {suggestedShopTemplates.map((category) => (
                        <option key={category} value={category} />
                      ))}
                    </datalist>
                    <p className="text-[11px] text-muted-foreground mt-1">Dropdown থেকে নিতে পারবেন, বা নিজে type করেও দিতে পারবেন।</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {suggestedShopTemplates.slice(0, 8).map((template) => (
                        <button
                          key={template}
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, shop_category: template }))}
                          className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100"
                        >
                          {template}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              <div>
                <Label>PAN Number *</Label>
                <Input
                  required
                  value={form.pan_no}
                  onChange={(e) => setForm((prev) => ({ ...prev, pan_no: String(e.target.value || "").toUpperCase() }))}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  className="mt-1.5 h-11 font-mono uppercase"
                  data-testid="reg-pan"
                />
                <p className="text-[11px] text-muted-foreground mt-1">PAN is mandatory and can be used for only one Shop or Service registration.</p>
              </div>
              <div>
                <Label>Aadhaar Number *</Label>
                <Input
                  required
                  value={form.aadhaar_no}
                  onChange={(e) => setForm((prev) => ({ ...prev, aadhaar_no: String(e.target.value || "").replace(/\D/g, "") }))}
                  placeholder="12-digit Aadhaar number"
                  maxLength={12}
                  className="mt-1.5 h-11 font-mono"
                  data-testid="reg-aadhaar"
                />
              </div>
              <div className="md:col-span-2">
                <Label>{isService ? "Service Description (optional)" : "Shop Description (optional)"}</Label>
                <Textarea rows={3} value={form.business_description} onChange={upd("business_description")} placeholder={isService ? "Briefly describe your service, slots or specialties..." : "Briefly describe your shop and available items..."} className="mt-1.5" data-testid="reg-description" />
              </div>
            </div>
          </section>

          <section>
            <h2 className="font-display font-black text-lg text-emerald-950">Contact Person</h2>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div>
                <Label>{isService ? "Owner / Service Manager Name *" : "Owner / Shop Manager Name *"}</Label>
                <Input required value={form.contact_person} onChange={upd("contact_person")} placeholder="Full name" className="mt-1.5 h-11" data-testid="reg-contact-name" />
              </div>
              <div>
                <Label>Phone *</Label>
                <Input required type="tel" value={form.phone} onChange={upd("phone")} placeholder="+91..." className="mt-1.5 h-11" data-testid="reg-phone" />
              </div>
              <div>
                <Label>Date of Birth <span className="text-xs text-muted-foreground">(Optional)</span></Label>
                <Input type="date" value={form.dob} onChange={upd("dob")} className="mt-1.5 h-11" data-testid="reg-dob" />
              </div>
              <div>
                <Label>Username *</Label>
                <Input required type="text" value={form.email} onChange={upd("email")} placeholder="Choose your partner username" className="mt-1.5 h-11" data-testid="reg-email" />
                <p className="text-[11px] text-muted-foreground mt-1">This will be your partner username after approval.</p>
              </div>
              <div>
                <Label>Password *</Label>
                <Input required type="password" minLength={6} value={form.password} onChange={upd("password")} placeholder="Minimum 6 characters" className="mt-1.5 h-11" data-testid="reg-password" />
              </div>
              <div>
                <Label>WhatsApp No (if different)</Label>
                <Input type="tel" value={form.whatsapp_no} onChange={upd("whatsapp_no")} placeholder="+91... (blank = same as phone)" className="mt-1.5 h-11" data-testid="reg-whatsapp" />
              </div>
            </div>
          </section>

          <section>
            <h2 className="font-display font-black text-lg text-emerald-950">Location</h2>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div className="md:col-span-2">
                <Label>Address *</Label>
                <Textarea required rows={2} value={form.address} onChange={upd("address")} placeholder="Shop no, street, area" className="mt-1.5" data-testid="reg-address" />
              </div>
              <div>
                <Label>State *</Label>
                <select
                  required
                  value={form.state}
                  onChange={(e) => setForm((prev) => ({ ...prev, state: e.target.value, district: "" }))}
                  className="mt-1.5 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                  data-testid="reg-state"
                >
                  <option value="">Select state</option>
                  {(indiaLocationMeta.states.length ? indiaLocationMeta.states : INDIAN_STATES).map((state) => <option key={state} value={state}>{state}</option>)}
                </select>
              </div>
              <div>
                <Label>District</Label>
                <select
                  value={form.district}
                  onChange={upd("district")}
                  className="mt-1.5 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                  data-testid="reg-district"
                >
                  <option value="">Select district</option>
                  {selectedDistrictOptions.map((district) => <option key={district} value={district}>{district}</option>)}
                </select>
              </div>
              <div>
                <Label>City *</Label>
                <select
                  required
                  value={form.city}
                  onChange={upd("city")}
                  className="mt-1.5 h-11 w-full rounded-md border border-input bg-white px-3 text-sm"
                  data-testid="reg-city"
                >
                  <option value="">Select city</option>
                  {selectedCityOptions.map((city) => <option key={city} value={city}>{city}</option>)}
                </select>
              </div>
              <div>
                <Label>Pincode</Label>
                <Input
                  value={form.pincode}
                  onChange={(e) => setForm((prev) => ({ ...prev, pincode: normalizePincode(e.target.value) }))}
                  placeholder="700001"
                  maxLength={6}
                  className="mt-1.5 h-11 font-mono"
                  data-testid="reg-pincode"
                />
                {pincodeBusy ? <p className="text-[11px] text-muted-foreground mt-1">Pincode থেকে city/district আনা হচ্ছে...</p> : null}
                {locationMetaBusy ? <p className="text-[11px] text-muted-foreground mt-1">State/district/city data loading...</p> : null}
              </div>
            </div>
          </section>

          <section>
            <h2 className="font-display font-black text-lg text-emerald-950">Payment & Web Presence (optional)</h2>
            <div className="grid md:grid-cols-2 gap-4 mt-4">
              <div>
                <Label>UPI ID</Label>
                <Input value={form.upi_id} onChange={upd("upi_id")} placeholder="business@paytm" className="mt-1.5 h-11 font-mono" data-testid="reg-upi" />
              </div>
              <div>
                <Label>Preferred Commission %</Label>
                <Input type="number" min={1} max={50} step="0.5" value={form.commission_percent_ask} onChange={upd("commission_percent_ask")} placeholder="e.g. 10" className="mt-1.5 h-11" data-testid="reg-commission" />
                <p className="text-[11px] text-muted-foreground mt-1">Final commission is decided by admin.</p>
              </div>
              <div>
                <Label>Website</Label>
                <Input value={form.website} onChange={upd("website")} placeholder="https://" className="mt-1.5 h-11" data-testid="reg-website" />
              </div>
              <div>
                <Label>Social Link</Label>
                <Input value={form.social_link} onChange={upd("social_link")} placeholder="Instagram / Facebook URL" className="mt-1.5 h-11" data-testid="reg-social" />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 md:p-5" data-testid="partner-policy-section">
            <h2 className="font-display font-black text-lg text-emerald-950">Partner Terms &amp; Conditions</h2>
            <p className="text-xs text-emerald-900/80 mt-1">Please review and accept the full legal terms before submitting your partner application.</p>
            <Link to="/partner-terms" target="_blank" rel="noreferrer" className="mt-3 inline-flex font-semibold text-emerald-950 underline" data-testid="partner-view-terms-link">View Partner Terms &amp; Conditions</Link>

            <label className="mt-4 flex items-start gap-2 text-sm text-slate-700" data-testid="agree-terms-box">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5"
                data-testid="partner-terms-checkbox"
              />
              <span>I have read and agree to the Partner Terms &amp; Conditions.</span>
            </label>
          </section>

          <div className="border-t border-border pt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground font-body max-w-md">
              Submission is enabled only after you tick the agreement checkbox. Your Shop or Service appears in the directory only after admin approval.
            </p>
            <Button type="submit" disabled={busy || !agreedToTerms} className="bg-emerald-900 hover:bg-emerald-950 text-white rounded-full px-8 h-12" data-testid="reg-submit">
              {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Submitting...</> : <><Send className="w-4 h-4 mr-2" /> Submit Application</>}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}

