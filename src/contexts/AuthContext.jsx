import React, { createContext, useContext, useEffect, useState } from "react";
import api from "@/services/api";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const buildIdentifierCandidates = (rawIdentifier) => {
    const input = String(rawIdentifier || "").trim();
    const candidates = [];
    const push = (value) => {
      const clean = String(value || "").trim();
      if (!clean) return;
      if (!candidates.includes(clean)) candidates.push(clean);
    };

    push(input);
    push(input.toLowerCase());
    push(input.toUpperCase());

    const compact = input.replace(/\s+/g, "");
    push(compact);

    const digitsOnly = input.replace(/[^\d]/g, "");
    if (digitsOnly.length >= 10) {
      push(digitsOnly);
      if (digitsOnly.length === 10) push(`+91${digitsOnly}`);
    }

    const looksLikeUsername = !input.includes("@") && /^[A-Za-z0-9._-]+$/.test(input);
    if (looksLikeUsername) {
      // Compatibility fallback for environments that still validate the "email" field strictly.
      push(`${input}@metho.com`);
      push(`${input.toLowerCase()}@metho.com`);
    }

    return candidates;
  };

  const buildLoginPayloads = (rawIdentifier, password) => {
    const identifiers = buildIdentifierCandidates(rawIdentifier);
    const payloads = [];

    identifiers.forEach((id) => {
      payloads.push({ email: id, password });
      payloads.push({ username: id, password });
      payloads.push({ login: id, password });
      payloads.push({ identifier: id, password });
      payloads.push({ phone: id, password });
      payloads.push({ member_code: id, password });
    });

    return payloads;
  };

  useEffect(() => {
    let active = true;

    const bootAuth = async () => {
      const stored = localStorage.getItem("metho_user");
      const token = localStorage.getItem("metho_token");

      if (stored) {
        try { if (active) setUser(JSON.parse(stored)); } catch (e) {}
      }

      if (token) {
        try {
          const { data } = await api.get("/auth/me");
          if (active) setUser(data);
          localStorage.setItem("metho_user", JSON.stringify(data));
        } catch (e) {
          localStorage.removeItem("metho_token");
          localStorage.removeItem("metho_user");
          if (active) setUser(null);
        }
      }

      if (active) setLoading(false);
    };

    bootAuth();
    return () => { active = false; };
  }, []);

  const login = async (username, password, options = {}) => {
    const identifier = String(username || "").trim();
    const adminMode = Boolean(options?.adminMode);
    const payloads = buildLoginPayloads(identifier, password);

    const endpoints = adminMode
      ? ["/auth/login", "/auth/admin/login", "/admin/login"]
      : ["/auth/login"];

    let lastError = null;

    const commitAuth = (responseData) => {
      const token = responseData?.token || responseData?.access_token || responseData?.jwt || "";
      const resolvedUser = responseData?.user || responseData?.profile || responseData?.data?.user || null;
      if (!token || !resolvedUser) {
        throw new Error("Login response missing token or user");
      }
      localStorage.setItem("metho_token", token);
      localStorage.setItem("metho_user", JSON.stringify(resolvedUser));
      setUser(resolvedUser);
      return resolvedUser;
    };

    for (const endpoint of endpoints) {
      for (const payload of payloads) {
        try {
          const { data } = await api.post(endpoint, payload);
          return commitAuth(data);
        } catch (jsonErr) {
          lastError = jsonErr;
          const jsonStatus = Number(jsonErr?.response?.status || 0);
          const jsonDetail = String(jsonErr?.response?.data?.detail || "").toLowerCase();
          const shouldTryForm =
            jsonStatus === 404 ||
            jsonStatus === 405 ||
            jsonStatus === 415 ||
            jsonStatus === 422 ||
            jsonDetail.includes("field required") ||
            jsonDetail.includes("valid dictionary") ||
            jsonDetail.includes("valid object");

          if (!shouldTryForm) {
            throw jsonErr;
          }

          try {
            const formBody = new URLSearchParams();
            Object.entries(payload).forEach(([k, v]) => formBody.append(k, v == null ? "" : String(v)));
            const { data } = await api.post(endpoint, formBody.toString(), {
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
            });
            return commitAuth(data);
          } catch (formErr) {
            // Preserve the more useful auth error when form fallback is only a compatibility probe.
            lastError = jsonErr?.response ? jsonErr : formErr;
            const status = Number(formErr?.response?.status || jsonErr?.response?.status || 0);
            const detail = String(formErr?.response?.data?.detail || jsonErr?.response?.data?.detail || "").toLowerCase();
            const isInvalidCred =
              status === 401 &&
              (
                detail.includes("invalid username or password") ||
                detail.includes("invalid email or password") ||
                detail.includes("invalid login id or password")
              );
            const isEndpointMismatch = status === 404 || status === 405 || status === 422;
            if (!adminMode || (!isInvalidCred && !isEndpointMismatch)) {
              throw lastError;
            }
          }
        }
      }
    }

    throw lastError || new Error("Login failed");
  };

  const register = async (payload) => {
    const confirmCreatedByThisRequest = async () => {
      const identifier = String(payload?.email || "").trim();
      const password = String(payload?.password || "");
      if (!identifier || !password) return false;
      const loginPayloads = buildLoginPayloads(identifier, password);
      for (const lp of loginPayloads) {
        try {
          await api.post("/auth/login", lp);
          return true;
        } catch (loginErr) {
          const status = Number(loginErr?.response?.status || 0);
          const detail = String(loginErr?.response?.data?.detail || "").toLowerCase();
          // Treat inactive account as created but not yet usable.
          if (status === 403 && (detail.includes("not active yet") || detail.includes("first approved purchase"))) {
            return true;
          }
          const invalid =
            status === 401 &&
            (
              detail.includes("invalid username or password") ||
              detail.includes("invalid email or password") ||
              detail.includes("invalid login id or password")
            );
          if (!invalid) {
            break;
          }
        }
      }
      return false;
    };

    const tryRegisterEndpoint = async (endpoint) => {
      try {
        const result = await api.post(endpoint, payload);
        return result?.data;
      } catch (endpointErr) {
        const status = Number(endpointErr?.response?.status || 0);
        const detail = String(endpointErr?.response?.data?.detail || "").toLowerCase();
        const looksDuplicate = detail.includes("username already registered") || (detail.includes("phone") && detail.includes("already"));
        if (looksDuplicate) {
          const ownedByThisRequest = await confirmCreatedByThisRequest();
          if (ownedByThisRequest) {
            return {
              registration_exists: true,
              message: "Registration appears completed. Please sign in.",
            };
          }
        }

        // Some backend builds create the member but return 500.
        // Confirm ownership before treating as a hard failure.
        if (status >= 500) {
          const ownedByThisRequest = await confirmCreatedByThisRequest();
          if (ownedByThisRequest) {
            return {
              registration_exists: true,
              message: "Registration appears completed. Please sign in.",
            };
          }
        }

        throw endpointErr;
      }
    };

    let data;
    try {
      // Prefer /register because /auth/register is currently CORS-blocked for web clients.
      data = await tryRegisterEndpoint("/register");
    } catch (primaryErr) {
      const status = Number(primaryErr?.response?.status || 0);
      const isNetworkLike = !primaryErr?.response;
      const shouldTryAuthRegister = isNetworkLike || status >= 500 || status === 404 || status === 405;
      if (!shouldTryAuthRegister) throw primaryErr;

      data = await tryRegisterEndpoint("/auth/register");
    }
    if (data?.token && data?.user) {
      localStorage.setItem("metho_token", data.token);
      localStorage.setItem("metho_user", JSON.stringify(data.user));
      setUser(data.user);
    } else {
      localStorage.removeItem("metho_token");
      localStorage.removeItem("metho_user");
      setUser(null);
    }
    return data;
  };

  const logout = () => {
    localStorage.removeItem("metho_token");
    localStorage.removeItem("metho_user");
    setUser(null);
  };

  const refresh = async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      localStorage.setItem("metho_user", JSON.stringify(data));
    } catch (e) {}
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);

