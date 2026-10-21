import axios from "axios";

// Em produção (frontend e backend em hosts diferentes), usa VITE_API_URL.
// Em dev local, cai pro mesmo host de onde a página foi carregada (funciona tanto
// acessando pelo computador via localhost quanto por outro dispositivo na rede via IP do Mac).
export const API_HOST =
  import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:3001`;

export const api = axios.create({
  baseURL: `${API_HOST}/api`,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(err);
  }
);
