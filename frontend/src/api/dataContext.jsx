import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import {
  amendments as mockAmendments,
  contracts as mockContracts,
  flags as mockFlags,
  initialAuditHistory as mockAuditHistory,
  invoices as mockInvoices,
  payments as mockPayments,
} from "../data/mockData";
import { adaptApiData } from "./adapter";
import { api, isApiConfigured, ApiError, getStoredToken, storeToken } from "./client";

const MOCK_DATA = {
  contracts: mockContracts,
  amendments: mockAmendments,
  invoices: mockInvoices,
  payments: mockPayments,
  flags: mockFlags,
  auditHistory: mockAuditHistory,
};

const AuditDataContext = createContext(null);

export function useAuditData() {
  const context = useContext(AuditDataContext);
  if (!context) throw new Error("useAuditData must be used inside <AuditDataProvider>");
  return context;
}

export function AuditDataProvider({ children }) {
  const mode = isApiConfigured ? "live" : "mock";
  const [token, setToken] = useState(() => getStoredToken());
  const [data, setData] = useState(MOCK_DATA);
  const [source, setSource] = useState("mock");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const controllerRef = useRef(null);

  const clearSession = useCallback(() => {
    storeToken(null);
    setToken(null);
    setData(MOCK_DATA);
    setSource("mock");
    setError(null);
  }, []);

  const load = useCallback(
    async (activeToken) => {
      if (mode !== "live" || !activeToken) return;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const contracts = await api.listContracts(activeToken, controller.signal);
        const evidences = await Promise.all(
          contracts.map((contract) => api.contractEvidence(activeToken, contract.id, controller.signal))
        );
        await api.reconcile(activeToken);
        const [cases, audit] = await Promise.all([
          api.listCases(activeToken, controller.signal),
          api.audit(activeToken, controller.signal),
        ]);
        const adapted = adaptApiData({
          contracts,
          amendments: evidences.flatMap((item) => item.amendments || []),
          invoices: evidences.flatMap((item) => item.invoices || []),
          payments: evidences.flatMap((item) => item.payments || []),
          cases,
          audit,
        });
        setData(adapted);
        setSource("api");
      } catch (thrown) {
        if (thrown?.name === "AbortError") return;
        if (thrown instanceof ApiError && thrown.status === 401) {
          clearSession();
          setError("Your session expired. Sign in again.");
          return;
        }
        setError(thrown?.message || "Failed to load live audit data.");
        setSource("mock");
      } finally {
        setLoading(false);
      }
    },
    [mode, clearSession]
  );

  useEffect(() => {
    let cancelled = false;
    async function initSession() {
      if (mode !== "live") return;
      if (token) {
        load(token);
        return;
      }
      try {
        const result = await api.devLogin("aud-urvashi-01", "reviewer");
        if (!cancelled && result?.access_token) {
          storeToken(result.access_token);
          setToken(result.access_token);
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || "Auto-session failed");
      }
    }
    initSession();
    return () => {
      cancelled = true;
      controllerRef.current?.abort();
    };
  }, [mode, token, load]);

  const login = useCallback(
    async (auditor) => {
      if (mode !== "live") {
        setToken("mock");
        return { token: "mock", role: "reviewer" };
      }
      setLoading(true);
      setError(null);
      try {
        const result = await api.devLogin(auditor.uid, auditor.appRole || "reviewer");
        storeToken(result.access_token);
        setToken(result.access_token);
        return result;
      } catch (thrown) {
        setError(thrown?.message || "Sign in failed.");
        throw thrown;
      } finally {
        setLoading(false);
      }
    },
    [mode]
  );

  const refresh = useCallback(() => {
    if (mode === "live" && token) return load(token);
    return Promise.resolve();
  }, [mode, token, load]);

  const resolveCase = useCallback(
    async (caseId, determination, note) => {
      if (mode !== "live" || !token) return null;
      const result = await api.resolveCase(token, caseId, determination, note);
      await load(token);
      return result;
    },
    [mode, token, load]
  );

  const addInvestigation = useCallback(
    async (caseId, action, note) => {
      if (mode !== "live" || !token) return null;
      const result = await api.addInvestigation(token, caseId, action, note);
      await load(token);
      return result;
    },
    [mode, token, load]
  );

  const analyzeCase = useCallback(
    async (caseId) => {
      if (mode !== "live" || !token) return null;
      return api.analyzeCase(token, caseId);
    },
    [mode, token]
  );

  const value = useMemo(
    () => ({
      mode,
      source,
      loading,
      error,
      isAuthenticated: mode === "mock" || Boolean(token),
      hasLiveToken: Boolean(token),
      ...data,
      login,
      logout: clearSession,
      refresh,
      resolveCase,
      addInvestigation,
      analyzeCase,
      clearError: () => setError(null),
    }),
    [mode, source, loading, error, token, data, login, clearSession, refresh, resolveCase, addInvestigation, analyzeCase]
  );

  return <AuditDataContext.Provider value={value}>{children}</AuditDataContext.Provider>;
}
