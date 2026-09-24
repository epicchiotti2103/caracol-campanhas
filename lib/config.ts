// API_BASE_URL ja inclui /api/v1 — endpoints sao passados como /campanhas, /auth/login etc.
const rawApi = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const trimmed = rawApi.replace(/\/+$/, "");
export const API_BASE_URL = /\/api\/v\d+$/.test(trimmed)
  ? trimmed
  : `${trimmed}/api/v1`;

export const HUB_URL =
  process.env.NEXT_PUBLIC_HUB_URL || "https://app.aeobr.com.br";

export const NF_URL = (
  process.env.NEXT_PUBLIC_NF_URL || "https://nf.aeobr.com.br"
).replace(/\/+$/, "");
