import axios from "axios";
import { getBackendBaseUrlOrDefault } from "@/lib/utils";

const BACKEND_URL = getBackendBaseUrlOrDefault("http://localhost:8000");
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("metho_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem("metho_token");
      localStorage.removeItem("metho_user");
    }
    return Promise.reject(err);
  }
);

export default api;

