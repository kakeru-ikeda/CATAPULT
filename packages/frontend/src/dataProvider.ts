import simpleRestProvider from "ra-data-simple-rest";
import { fetchUtils } from "react-admin";

const httpClient = (url: string, options: Parameters<typeof fetchUtils.fetchJson>[1] = {}) => {
  const headers = new Headers(options.headers);
  const token = localStorage.getItem("token");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetchUtils.fetchJson(url, { ...options, headers });
};

export const dataProvider = simpleRestProvider(
  `${(import.meta.env.VITE_API_URL as string | undefined) ?? ""}/api`,
  httpClient,
);
