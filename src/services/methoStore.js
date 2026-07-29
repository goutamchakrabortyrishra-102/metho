import api from "@/services/api";

const callFirst = async (calls) => {
  let lastErr = null;
  for (const call of calls) {
    try {
      const { data } = await call();
      return data;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Request failed");
};

const toArray = (value) => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.data)) return value.data;
  return [];
};

export const methoStoreApi = {
  adminListOwners: async () => {
    const { data } = await api.get("/metho-store/admin/owners");
    return data;
  },
  adminCreateOwner: async (payload) => {
    const { data } = await api.post("/metho-store/admin/owners", payload);
    return data;
  },
  adminApproveOwner: async (ownerId, payload = {}) => {
    const { data } = await api.post(`/metho-store/admin/owners/${ownerId}/approve`, payload);
    return data;
  },
  adminUpdateOwnerCommission: async (ownerId, payload) => {
    const { data } = await api.put(`/metho-store/admin/owners/${ownerId}/commission`, payload);
    return data;
  },
  adminListCatalogItems: async () => {
    const { data } = await api.get("/metho-store/admin/catalog/items");
    return data;
  },
  adminCreateCatalogItem: async (payload) => {
    const { data } = await api.post("/metho-store/admin/catalog/items", payload);
    return data;
  },
  adminAllocateInventory: async (ownerId, payload) => {
    const { data } = await api.post(`/metho-store/admin/owners/${ownerId}/inventory/allocate`, payload);
    return data;
  },
  adminOwnerInventory: async (ownerId) => {
    const { data } = await api.get(`/metho-store/admin/owners/${ownerId}/inventory`);
    return data;
  },
  adminUpdateOwner: async (ownerId, payload) => {
    return callFirst([
      () => api.put(`/metho-store/admin/owners/${ownerId}`, payload),
      () => api.patch(`/metho-store/admin/owners/${ownerId}`, payload),
      () => api.put(`/metho-store/admin/owners/${ownerId}/update`, payload),
    ]);
  },
  adminDeleteOwner: async (ownerId) => {
    return callFirst([
      () => api.delete(`/metho-store/admin/owners/${ownerId}`),
      () => api.post(`/metho-store/admin/owners/${ownerId}/delete`, {}),
    ]);
  },
  adminSetOwnerActive: async (ownerId, isActive) => {
    return callFirst([
      () => api.put(`/metho-store/admin/owners/${ownerId}/active`, { is_active: !!isActive }),
      () => api.patch(`/metho-store/admin/owners/${ownerId}/active`, { is_active: !!isActive }),
      () => api.post(`/metho-store/admin/owners/${ownerId}/${isActive ? "activate" : "deactivate"}`, {}),
      () => api.put(`/metho-store/admin/owners/${ownerId}`, { is_active: !!isActive }),
    ]);
  },
  adminResetOwnerPassword: async (ownerId, password = "") => {
    const payload = password ? { password } : {};
    return callFirst([
      () => api.post(`/metho-store/admin/owners/${ownerId}/reset-password`, payload),
      () => api.post(`/metho-store/admin/owners/${ownerId}/password`, payload),
      () => api.put(`/metho-store/admin/owners/${ownerId}/password`, payload),
      () => api.patch(`/metho-store/admin/owners/${ownerId}/password`, payload),
    ]);
  },
  adminUploadOwnerBanner: async (ownerId, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return callFirst([
      () => api.post(`/metho-store/admin/owners/${ownerId}/banner`, fd, { headers: { "Content-Type": "multipart/form-data" } }),
      () => api.post(`/metho-store/admin/owners/${ownerId}/upload-banner`, fd, { headers: { "Content-Type": "multipart/form-data" } }),
      () => api.put(`/metho-store/admin/owners/${ownerId}/banner`, fd, { headers: { "Content-Type": "multipart/form-data" } }),
    ]);
  },
  adminListOwnerInvoices: async (ownerId) => {
    return callFirst([
      () => api.get(`/metho-store/admin/owners/${ownerId}/invoices`),
      () => api.get(`/metho-store/admin/owner/${ownerId}/invoices`),
      () => api.get(`/metho-store/admin/invoices`, { params: { owner_id: ownerId } }),
    ]);
  },
  adminCreateOwnerInvoice: async (ownerId, payload) => {
    return callFirst([
      () => api.post(`/metho-store/admin/owners/${ownerId}/invoices`, payload),
      () => api.post(`/metho-store/admin/owner/${ownerId}/invoices`, payload),
      () => api.post(`/metho-store/admin/invoices`, { owner_id: ownerId, ...payload }),
    ]);
  },
  ownerMe: async () => {
    const { data } = await api.get("/metho-store/owner/me");
    return data;
  },
  ownerInventory: async () => {
    const { data } = await api.get("/metho-store/owner/me/inventory");
    return data;
  },
  ownerCreateInvoice: async (payload) => {
    const { data } = await api.post("/metho-store/owner/invoices", payload);
    return data;
  },
};

export const normalizeCollection = toArray;

export const getErrorText = (err, fallback) => {
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    if (typeof first === "string") return first;
    if (first?.msg) return String(first.msg);
  }
  if (detail && typeof detail === "object") {
    if (typeof detail.message === "string" && detail.message.trim()) return detail.message;
    if (typeof detail.msg === "string" && detail.msg.trim()) return detail.msg;
  }
  if (typeof err?.message === "string" && err.message.trim()) return err.message;
  return fallback;
};

export const ownerLabel = (owner) => {
  if (!owner || typeof owner !== "object") return "Owner";
  return owner.store_name || owner.business_name || owner.name || owner.owner_name || owner.email || owner.phone || owner.id || "Owner";
};