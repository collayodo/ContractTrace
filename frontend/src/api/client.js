// Thin REST client for the ContractTrace FastAPI backend.
//
// The dashboard runs standalone with bundled demo data unless VITE_API_BASE_URL
// is set. When it is set, every read and write below goes to the live API using
// a bearer token obtained from POST /auth/dev-login (see dataContext.jsx).

const RAW_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim();

export const API_BASE_URL = RAW_BASE_URL.replace(/\/+$/, "");
export const isApiConfigured = API_BASE_URL.length > 0;

const TOKEN_KEY = "contracttrace.token";

export function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage can be unavailable (private mode); stay in memory only.
  }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request(path, { method = "GET", body, token, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError("Cannot reach the API. Check VITE_API_BASE_URL and that the backend is running.", 0);
  }

  const text = response.status === 204 ? "" : await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const detail = payload && typeof payload === "object" ? payload.detail : payload;
    throw new ApiError(typeof detail === "string" && detail ? detail : `Request failed (${response.status})`, response.status);
  }
  return payload;
}

export const api = {
  devLogin: (userId, role) =>
    request("/auth/dev-login", { method: "POST", body: { user_id: userId, role } }),
  listContracts: (token, signal) => request("/contracts", { token, signal }),
  contractEvidence: (token, contractId, signal) =>
    request(`/contracts/${encodeURIComponent(contractId)}/evidence`, { token, signal }),
  reconcile: (token) => request("/reconcile", { method: "POST", token }),
  listCases: (token, signal) => request("/cases", { token, signal }),
  resolveCase: (token, caseId, determination, note) =>
    request(`/cases/${encodeURIComponent(caseId)}/resolve`, {
      method: "POST",
      token,
      body: { determination, note },
    }),
  addInvestigation: (token, caseId, action, note) =>
    request(`/cases/${encodeURIComponent(caseId)}/investigation`, {
      method: "POST",
      token,
      body: { action, note },
    }),
  analyzeCase: (token, caseId) =>
    request(`/cases/${encodeURIComponent(caseId)}/ai-analysis`, { method: "POST", token }),
  audit: (token, signal) => request("/audit", { token, signal }),
  verifyAudit: (token) => request("/audit/verify", { token }),
};
