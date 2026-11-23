import { useMemo, useState, useEffect } from "react";
import Icon from "./components/Icon";
import {
  Card,
  CardHeader,
  Donut,
  MiniBars,
  Modal,
  SearchBox,
  Select,
  SeverityBadge,
  StatusBadge,
} from "./components/UI";
import { AUDITORS, formatDate, formatMoney, RULE_CATALOG, getRuleMeta } from "./data/mockData";
import { useAuditData } from "./api/dataContext";

const nav = [
  ["overview", "Overview", "grid"],
  ["workbench", "Reviewer Workbench", "search"],
  ["contracts", "Contracts Explorer", "file"],
  ["flags", "Audit Flags", "flag"],
  ["analytics", "Operational Analytics", "chart"],
  ["history", "Investigation History", "history"],
];

const pageInfo = {
  overview: ["Overview", "Public-spending audit posture and active verification queue"],
  workbench: [
    "Reviewer Workbench",
    "Inspect contract dossiers, verify deterministic rules, and record audit determinations",
  ],
  contracts: ["Contracts Explorer", "Search procurement contracts, cap utilization, and linked vouchers"],
  flags: ["Audit Flags", "Manage deterministic Rule 1, Rule 2, and Rule 3 exception signals"],
  analytics: ["Operational Analytics", "Portfolio financial exposure, rule frequencies, and cap utilization"],
  history: ["Investigation History", "Immutable audit trail of system rule triggers and auditor determinations"],
};

// ==========================================
// DETERMINISTIC RULE ENGINE HELPERS
// ==========================================

function getEligibleInvoices(contractId, allInvoices) {
  const contractInvoices = allInvoices.filter((i) => i.contract === contractId);
  const allowedStatuses = ["APPROVED", "FLAGGED", "SETTLED", "PAID", "ELIGIBLE"];
  const seenIds = new Set();
  const eligible = [];

  for (const inv of contractInvoices) {
    const statusUpper = (inv.status || "").toUpperCase();
    if (allowedStatuses.includes(statusUpper) && !seenIds.has(inv.id)) {
      seenIds.add(inv.id);
      eligible.push(inv);
    }
  }
  return eligible;
}

function getResolvedAmendment(contract, allAmendments, eligibleTotal, flagRule) {
  if (!contract || flagRule !== "RULE_1_OVERBILL") return null;
  const contractAmendments = allAmendments.filter((a) => a.contract === contract.id);
  const today = new Date().toISOString().split("T")[0];

  const validAmendments = contractAmendments.filter((am) => {
    const isExecuted = (am.status || "").toUpperCase() === "EXECUTED";
    const effectiveDate = am.effectiveDate || am.date;
    const dateReached = effectiveDate ? effectiveDate <= today : true;
    const revisedCap = am.newCap || 0;
    return isExecuted && dateReached && revisedCap >= eligibleTotal;
  });

  if (validAmendments.length === 0) return null;

  return validAmendments.reduce((latest, current) =>
    (current.effectiveDate || "") > (latest.effectiveDate || "") ? current : latest
  );
}

// ==========================================
// AUDITOR LOGIN SCREEN
// ==========================================

function AuditorLogin({ onLogin, busy = false, errorMessage = "" }) {
  const [selectedUid, setSelectedUid] = useState(AUDITORS[0].uid);
  const [emailInput, setEmailInput] = useState(AUDITORS[0].email);
  const [passwordInput, setPasswordInput] = useState("••••••••••••");

  const handleSelectProfile = (aud) => {
    setSelectedUid(aud.uid);
    setEmailInput(aud.email);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const auditor = AUDITORS.find((a) => a.uid === selectedUid) || AUDITORS[0];
    try {
      await onLogin(auditor);
    } catch {
      // The provider surfaces the failure through errorMessage.
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        display: "grid",
        placeItems: "center",
        padding: "24px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "520px",
          background: "#ffffff",
          border: "1px solid #e2e8f0",
          borderRadius: "14px",
          boxShadow: "0 12px 32px rgba(15, 23, 42, 0.08)",
          padding: "32px",
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
          <div className="brand-mark">
            <Icon name="file" size={18} />
            <i />
          </div>
          <div>
            <strong style={{ fontSize: "18px", display: "block" }}>ContractTrace</strong>
            <span style={{ fontSize: "12px", color: "#64748b" }}>
              Public Spending Oversight · UN SDG 16.6
            </span>
          </div>
        </div>

        <h1 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "6px" }}>
          Auditor Authentication
        </h1>
        <p style={{ fontSize: "13px", color: "#64748b", marginBottom: "20px", lineHeight: 1.5 }}>
          Sign in with your accredited auditor credentials. All flag assignments, confirmations, and dismissals are stamped with your Auditor UID.
        </p>

        {errorMessage && (
          <div
            style={{
              marginBottom: "16px",
              padding: "10px 12px",
              borderRadius: "8px",
              border: "1px solid #fecaca",
              background: "#fef2f2",
              color: "#b91c1c",
              fontSize: "12.5px",
              lineHeight: 1.5,
            }}
          >
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: "14px" }}>
          <div style={{ minWidth: 0 }}>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>
              Select Accredited Auditor Profile (Quick Demo Sign-In)
            </label>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: "10px",
              }}
            >
              {AUDITORS.map((aud) => {
                const active = aud.uid === selectedUid;
                return (
                  <button
                    type="button"
                    key={aud.uid}
                    onClick={() => handleSelectProfile(aud)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      padding: "10px",
                      borderRadius: "8px",
                      border: active ? "1.5px solid #00689d" : "1px solid #e2e8f0",
                      background: active ? "#e6f2f8" : "#ffffff",
                      textAlign: "left",
                      minWidth: 0,
                      overflow: "hidden",
                    }}
                  >
                    <span
                      className="avatar"
                      style={{ width: "30px", height: "30px", fontSize: "11px", flexShrink: 0 }}
                    >
                      {aud.initials}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: "12.5px",
                          fontWeight: 600,
                          color: "#0f172a",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {aud.name}
                      </div>
                      <div
                        style={{
                          fontSize: "11px",
                          color: "#64748b",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        title={aud.role}
                      >
                        {aud.role}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
              Institutional Email
            </label>
            <input
              type="email"
              required
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              style={{
                width: "100%",
                height: "38px",
                padding: "0 12px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                fontSize: "13px",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>
              Access Passkey / Token
            </label>
            <input
              type="password"
              required
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              style={{
                width: "100%",
                height: "38px",
                padding: "0 12px",
                borderRadius: "8px",
                border: "1px solid #cbd5e1",
                fontSize: "13px",
              }}
            />
          </div>

          <button
            type="submit"
            className="button primary"
            disabled={busy}
            style={{ width: "100%", height: "40px", marginTop: "4px", fontWeight: 600, opacity: busy ? 0.7 : 1 }}
          >
            {busy ? "Authenticating…" : `Sign In as ${AUDITORS.find((a) => a.uid === selectedUid)?.name} →`}
          </button>
        </form>
      </div>
    </div>
  );
}

// ==========================================
// MAIN APPLICATION
// ==========================================

export default function App() {
  const {
    flags,
    mode,
    source,
    loading,
    error: dataError,
    hasLiveToken,
    login,
    logout,
    resolveCase,
    refresh,
  } = useAuditData();
  const [currentAuditor, setCurrentAuditor] = useState(AUDITORS[0]);
  const [forceLogin, setForceLogin] = useState(false);
  const [page, setPage] = useState("overview");
  const [selectedFlagId, setSelectedFlagId] = useState(flags[0]?.id || "");
  const [selectedContractId, setSelectedContractId] = useState("");
  const [decisions, setDecisions] = useState({});
  const [assignments, setAssignments] = useState({
    "CASE-002": "aud-urvashi-01",
    "CASE-003": "aud-collins-02",
    "CASE-008": "aud-zayyan-03",
    "CASE-009": "",
  });
  const [assignmentLogs, setAssignmentLogs] = useState([]);
  const [globalSearch, setGlobalSearch] = useState("");
  const [showRulesModal, setShowRulesModal] = useState(false);

  const activeFlags = useMemo(() => {
    return flags.filter((f) => (decisions[f.id]?.status || f.status) === "ACTIVE");
  }, [flags, decisions]);

  // Keep the workbench selection valid when the dataset switches (mock -> live).
  useEffect(() => {
    if (flags.length > 0 && !flags.some((f) => f.id === selectedFlagId)) {
      setSelectedFlagId(flags[0].id);
    }
  }, [flags, selectedFlagId]);

  const currentFlag = flags.find((f) => f.id === selectedFlagId) || flags[0];

  const handleAssignAuditor = (caseId, auditorUid) => {
    const f = flags.find((item) => item.id === caseId);
    const assignedAud = AUDITORS.find((a) => a.uid === auditorUid);
    setAssignments((prev) => ({
      ...prev,
      [caseId]: auditorUid,
    }));
    setAssignmentLogs((prev) => [
      {
        id: `ASSIGN-${Date.now()}`,
        caseId,
        contractId: f?.contract || "Unknown",
        auditor: `${currentAuditor.name} (${currentAuditor.uid})`,
        action: assignedAud ? `Assigned to ${assignedAud.name}` : "Unassigned case",
        fromStatus: "ACTIVE",
        toStatus: decisions[caseId]?.status || f?.status || "ACTIVE",
        timestamp: new Date().toISOString(),
        note: assignedAud
          ? `Case routed to ${assignedAud.name} (${assignedAud.role}) for verification.`
          : "Case returned to unassigned review pool.",
      },
      ...prev,
    ]);
  };

  const handleRecordDecision = async (flagId, newStatus, notesText) => {
    setDecisions((prev) => ({
      ...prev,
      [flagId]: {
        status: newStatus,
        notes: notesText,
        timestamp: new Date().toISOString(),
        auditor: `${currentAuditor.name} (${currentAuditor.uid})`,
      },
    }));
    if (mode === "live") {
      const determination = newStatus === "CONFIRMED" ? "confirmed_issue" : "dismissed";
      try {
        await resolveCase(flagId, determination, notesText);
      } catch (thrown) {
        // The banner surfaces the API error; keep the local record so the auditor sees their note.
      }
    }
  };

  const needsLogin = (mode === "live" && !hasLiveToken) || forceLogin;

  if (needsLogin) {
    return (
      <AuditorLogin
        busy={loading}
        errorMessage={dataError}
        onLogin={async (aud) => {
          if (mode === "live") await login(aud);
          setCurrentAuditor(aud);
          setForceLogin(false);
        }}
      />
    );
  }

  return (
    <Shell
      page={page}
      setPage={setPage}
      activeCount={activeFlags.length}
      flags={flags}
      decisions={decisions}
      currentAuditor={currentAuditor}
      source={source}
      loading={loading}
      dataError={dataError}
      onRetry={refresh}
      onSwitchAuditor={() => {
        if (mode === "live") logout();
        setForceLogin(true);
      }}
      globalSearch={globalSearch}
      setGlobalSearch={setGlobalSearch}
      onOpenRules={() => setShowRulesModal(true)}
      onSelectSearchResult={(type, id) => {
        setGlobalSearch("");
        if (type === "flag") {
          setSelectedFlagId(id);
          setSelectedContractId("");
          setPage("workbench");
        } else {
          setSelectedContractId(id);
          setPage("workbench");
        }
      }}
      onSelectNotification={(fId) => {
        setSelectedFlagId(fId);
        setSelectedContractId("");
        setPage("workbench");
      }}
    >
      {page === "overview" && (
        <Overview
          go={setPage}
          decisions={decisions}
          assignments={assignments}
          selectFlag={(id) => {
            setSelectedFlagId(id);
            setSelectedContractId("");
            setPage("workbench");
          }}
        />
      )}
      {page === "workbench" && (
        <Workbench
          flag={currentFlag}
          contractIdOverride={selectedContractId}
          decisions={decisions}
          assignments={assignments}
          onAssignAuditor={handleAssignAuditor}
          onRecordDecision={handleRecordDecision}
          selectFlag={setSelectedFlagId}
          selectContract={setSelectedContractId}
          go={setPage}
        />
      )}
      {page === "contracts" && (
        <ContractsPage
          go={setPage}
          decisions={decisions}
          globalSearch={globalSearch}
          selectContract={(cId) => {
            setSelectedContractId(cId);
            setPage("workbench");
          }}
        />
      )}
      {page === "flags" && (
        <FlagsPage
          decisions={decisions}
          assignments={assignments}
          onAssignAuditor={handleAssignAuditor}
          globalSearch={globalSearch}
          selectFlag={(id) => {
            setSelectedFlagId(id);
            setSelectedContractId("");
            setPage("workbench");
          }}
        />
      )}
      {page === "analytics" && <Analytics decisions={decisions} />}
      {page === "history" && (
        <HistoryPage
          decisions={decisions}
          assignmentLogs={assignmentLogs}
          globalSearch={globalSearch}
        />
      )}

      {showRulesModal && (
        <Modal
          title="Deterministic Verification Rules (SDG 16.6)"
          subtitle="A flag is an investigative signal, never an automated finding of wrongdoing."
          onClose={() => setShowRulesModal(false)}
          actions={
            <button className="button primary" onClick={() => setShowRulesModal(false)}>
              Close Rules Guide
            </button>
          }
        >
          <div style={{ display: "grid", gap: "14px" }}>
            {Object.values(RULE_CATALOG).map((rule) => (
              <div
                key={rule.code}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "14px",
                  background: "#f8fafc",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                  <strong style={{ fontSize: "13.5px", color: "#0f172a" }}>{rule.title}</strong>
                  <span className="status status-small">{rule.category}</span>
                </div>
                <div style={{ margin: "8px 0" }}>
                  <code>{rule.formula}</code>
                </div>
                <p style={{ fontSize: "12.5px", color: "#475569", lineHeight: 1.5 }}>{rule.description}</p>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </Shell>
  );
}

function Shell({
  page,
  setPage,
  activeCount,
  flags,
  decisions,
  currentAuditor,
  source,
  loading,
  dataError,
  onRetry,
  onSwitchAuditor,
  globalSearch,
  setGlobalSearch,
  onOpenRules,
  onSelectSearchResult,
  onSelectNotification,
  children,
}) {
  const { contracts } = useAuditData();
  const [mobile, setMobile] = useState(false);
  const [notice, setNotice] = useState(false);
  const [profile, setProfile] = useState(false);

  const go = (p) => {
    setPage(p);
    setMobile(false);
    window.scrollTo(0, 0);
  };

  const activeNoticeFlags = flags.filter((f) => (decisions[f.id]?.status || f.status) === "ACTIVE");

  // Instant search dropdown results across contracts & flags
  const quickSearchMatches = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return [];
    const matchedContracts = contracts
      .filter(
        (c) =>
          c.id.toLowerCase().includes(q) ||
          c.vendor.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q)
      )
      .slice(0, 4)
      .map((c) => ({
        type: "contract",
        id: c.id,
        title: `${c.id} · ${c.vendor}`,
        subtitle: c.title,
      }));
    const matchedFlags = flags
      .filter(
        (f) =>
          f.id.toLowerCase().includes(q) ||
          getRuleMeta(f.rule).shortName.toLowerCase().includes(q) ||
          f.evidence.toLowerCase().includes(q)
      )
      .slice(0, 3)
      .map((f) => ({
        type: "flag",
        id: f.id,
        title: `${f.id} (${f.contract})`,
        subtitle: getRuleMeta(f.rule).shortName,
      }));
    return [...matchedFlags, ...matchedContracts].slice(0, 6);
  }, [globalSearch, flags, contracts]);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Icon name="file" size={18} />
            <i />
          </div>
          <div>
            <strong>ContractTrace</strong>
            <span>Public Spending Oversight</span>
          </div>
        </div>
        <nav>
          {nav.map(([id, label, icon]) => (
            <button key={id} className={page === id ? "active" : ""} onClick={() => go(id)}>
              <Icon name={icon} size={16} />
              <span>{label}</span>
              {id === "flags" && <b>{activeCount}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="system">
            <i />
            <span>
              <small>UN SDG 16.6 Engine</small>
              <strong>3 Deterministic Rules</strong>
            </span>
          </div>
          <div className="side-user">
            <span className="avatar">{currentAuditor.initials}</span>
            <span>
              <strong>{currentAuditor.name}</strong>
              <small>{currentAuditor.role}</small>
            </span>
          </div>
        </div>
      </aside>
      {mobile && <div className="scrim" onClick={() => setMobile(false)} />}
      <main className="main">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setMobile(true)}>
            <Icon name="menu" />
          </button>
          <div className="page-title">
            <h1>{pageInfo[page]?.[0] || page}</h1>
            <p>{pageInfo[page]?.[1] || "Audit oversight dashboard"}</p>
          </div>
          <div className="top-actions">
            <button className="button subtle" onClick={onOpenRules}>
              <Icon name="help" size={15} />
              <span>Rules 1–3 Guide</span>
            </button>

            <div className="popover-anchor">
              <SearchBox
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Search contract ID, vendor, case, or rule…"
              />
              {globalSearch.trim() !== "" && (
                <div className="popover notifications" style={{ left: 0, right: "auto", width: "360px" }}>
                  <h4>
                    Matching Records <span>{quickSearchMatches.length} found</span>
                  </h4>
                  {quickSearchMatches.length === 0 ? (
                    <div style={{ padding: "14px 16px", fontSize: "13px", color: "#64748b" }}>
                      No contracts or cases match “{globalSearch}”.
                    </div>
                  ) : (
                    quickSearchMatches.map((item) => (
                      <button
                        key={`${item.type}-${item.id}`}
                        onClick={() => onSelectSearchResult(item.type, item.id)}
                      >
                        <b>{item.title}</b>
                        <span>{item.subtitle}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            <div className="popover-anchor">
              <button
                className="icon-button"
                onClick={() => {
                  setNotice(!notice);
                  setProfile(false);
                }}
              >
                <Icon name="bell" size={17} />
                {activeNoticeFlags.length > 0 && <i />}
              </button>
              {notice && (
                <div className="popover notifications">
                  <h4>
                    Active Review Queue <span>{activeNoticeFlags.length} open</span>
                  </h4>
                  {activeNoticeFlags.length === 0 ? (
                    <div style={{ padding: "16px", fontSize: "13px", color: "#64748b" }}>
                      All active flags have been reviewed.
                    </div>
                  ) : (
                    activeNoticeFlags.map((f) => {
                      const meta = getRuleMeta(f.rule);
                      return (
                        <button
                          key={f.id}
                          onClick={() => {
                            onSelectNotification(f.id);
                            setNotice(false);
                          }}
                        >
                          <b>
                            {f.contract} · {meta.shortName}
                          </b>
                          <span>{f.evidence.slice(0, 78)}…</span>
                          <small>Triggered {formatDate(f.created)}</small>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            <div className="popover-anchor">
              <button
                className="profile-button"
                onClick={() => {
                  setProfile(!profile);
                  setNotice(false);
                }}
              >
                <span className="avatar">{currentAuditor.initials}</span>
                <span>{currentAuditor.name}</span>
                <Icon name="down" size={14} />
              </button>
              {profile && (
                <div className="popover profile-menu">
                  <div>
                    <span className="avatar">{currentAuditor.initials}</span>
                    <p>
                      <strong>{currentAuditor.name}</strong>
                      <small>{currentAuditor.uid}</small>
                    </p>
                  </div>
                  <button onClick={() => { setProfile(false); go("history"); }}>
                    Audit Decision Log
                  </button>
                  <button onClick={() => { setProfile(false); onSwitchAuditor(); }}>
                    Switch Auditor / Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="demo-banner">
          <span>
            <strong>Governance Principle:</strong> “A flag is a signal to investigate, never a final finding.” · Signed in as{" "}
            <strong>{currentAuditor.name}</strong> ({currentAuditor.role})
          </span>
          <span style={{ fontSize: "11.5px", color: "#64748b" }}>UN SDG Target 16.6</span>
        </div>
        {(source === "api" || loading || dataError) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "12px",
              margin: "0 24px",
              padding: "8px 12px",
              borderRadius: "8px",
              fontSize: "12px",
              border: dataError ? "1px solid #fecaca" : "1px solid #bbf7d0",
              background: dataError ? "#fef2f2" : "#f0fdf4",
              color: dataError ? "#b91c1c" : "#15803d",
            }}
          >
            <span>
              {loading
                ? "Loading live audit data from the ContractTrace API…"
                : dataError
                ? `${dataError} Showing bundled demo data instead.`
                : "Live data connected to the ContractTrace API."}
            </span>
            {!loading && (
              <button
                className="text-button"
                style={{ fontSize: "12px" }}
                onClick={onRetry}
              >
                {dataError ? "Retry connection" : "Refresh"}
              </button>
            )}
          </div>
        )}
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

function Overview({ go, decisions, assignments, selectFlag }) {
  const { flags, contracts, invoices } = useAuditData();
  const activeFlags = useMemo(
    () => flags.filter((f) => (decisions[f.id]?.status || f.status) === "ACTIVE"),
    [flags, decisions]
  );
  const confirmedFlags = useMemo(
    () => flags.filter((f) => (decisions[f.id]?.status || f.status) === "CONFIRMED"),
    [flags, decisions]
  );
  const dismissedFlags = useMemo(
    () => flags.filter((f) => (decisions[f.id]?.status || f.status) === "DISMISSED"),
    [flags, decisions]
  );
  const resolvedFlags = useMemo(
    () => flags.filter((f) => (decisions[f.id]?.status || f.status) === "RESOLVED_BY_AMENDMENT"),
    [flags, decisions]
  );

  const humanDecisionsCount = confirmedFlags.length + dismissedFlags.length;
  const totalAuditableFlags = flags.length - resolvedFlags.length;
  const progressRatio =
    totalAuditableFlags > 0 ? Math.round((humanDecisionsCount / totalAuditableFlags) * 100) : 0;

  const totalPortfolioCap = useMemo(
    () => contracts.reduce((sum, c) => sum + c.cap, 0),
    [contracts]
  );

  const kpis = [
    ["Active Signals", String(activeFlags.length), "Requiring auditor determination", "flag", "red"],
    ["Confirmed Issues", String(confirmedFlags.length), "Verified audit exceptions", "check", "green"],
    ["Resolved by Amendment", String(resolvedFlags.length), "Cleared via Rule 3 cap updates", "file", "amber"],
    ["Authorized Portfolio", formatMoney(totalPortfolioCap), `Across ${contracts.length} public contracts`, "chart", "blue"],
  ];

  return (
    <div className="page-stack">
      <div className="kpi-grid">
        {kpis.map(([l, v, n, i, t]) => (
          <Card className="kpi" key={l}>
            <div className={`kpi-icon ${t}`}>
              <Icon name={i} size={18} />
            </div>
            <div>
              <span>{l}</span>
              <strong>{v}</strong>
              <small>{n}</small>
            </div>
          </Card>
        ))}
      </div>

      <div className="dashboard-grid">
        <Card>
          <CardHeader
            title="Exceptions by Deterministic Rule"
            icon="flag"
            subtitle="Distribution across Rule 1, Rule 2, and Rule 3"
          />
          <div className="chart-body">
            <MiniBars
              values={[
                flags.filter((f) => f.rule === "RULE_1_OVERBILL" && f.status === "ACTIVE").length,
                flags.filter((f) => f.rule === "RULE_2_TEMPORAL").length,
                resolvedFlags.length,
                contracts.filter((c) => c.status === "CLEAN").length,
              ]}
              labels={["Rule 1 Overbill", "Rule 2 Temporal", "Rule 3 Resolved", "Clean"]}
              colors={["#e11d48", "#ea580c", "#d97706", "#059669"]}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Auditor Decision Outcomes"
            icon="check"
            subtitle="Confirmed exceptions vs. dismissed signals"
          />
          <div className="outcomes">
            <Donut
              primary={
                humanDecisionsCount > 0
                  ? Math.round((confirmedFlags.length / humanDecisionsCount) * 100)
                  : 0
              }
              label={`${
                humanDecisionsCount > 0
                  ? Math.round((confirmedFlags.length / humanDecisionsCount) * 100)
                  : 0
              }%`}
              caption="Confirmed"
            />
            <div className="outcome-list">
              <div>
                <span>
                  <i className="green" />
                  Confirmed
                </span>
                <strong>{confirmedFlags.length}</strong>
              </div>
              <div>
                <span>
                  <i className="slate" />
                  Dismissed
                </span>
                <strong>{dismissedFlags.length}</strong>
              </div>
              <div>
                <span>
                  <i className="amber" />
                  Rule 3 Resolved
                </span>
                <strong>{resolvedFlags.length}</strong>
              </div>
              <small>
                <Icon name="clock" size={14} />
                {humanDecisionsCount} of {totalAuditableFlags} reviews done
              </small>
            </div>
          </div>
        </Card>

        <Card className="queue-card">
          <CardHeader
            title="Priority Investigation Queue"
            icon="users"
            action={
              <button
                className="button primary"
                style={{ height: "30px", fontSize: "12px", padding: "0 10px" }}
                onClick={() => go("workbench")}
              >
                Open Workbench →
              </button>
            }
          />
          <div className="queue-stats">
            <div>
              <strong>{activeFlags.length}</strong>
              <span>Open flags</span>
            </div>
            <div>
              <strong>{contracts.length}</strong>
              <span>Contracts</span>
            </div>
            <div>
              <strong>{invoices.length}</strong>
              <span>Invoices</span>
            </div>
          </div>
          <div className="progress">
            <span>
              Review completion <b>{progressRatio}%</b>
            </span>
            <div>
              <i style={{ width: `${progressRatio}%` }} />
            </div>
          </div>
          {activeFlags.length === 0 ? (
            <div style={{ padding: "16px", textAlign: "center", color: "#64748b", fontSize: "13px" }}>
              Queue clear — all open signals have been adjudicated.
            </div>
          ) : (
            activeFlags.slice(0, 1).map((flag) => {
              const contract = contracts.find((c) => c.id === flag.contract);
              const meta = getRuleMeta(flag.rule);
              const assigned = AUDITORS.find((a) => a.uid === assignments[flag.id]);
              return (
                <button className="queue-item" key={flag.id} onClick={() => selectFlag(flag.id)}>
                  <SeverityBadge severity={flag.severity} />
                  <span>
                    <strong>
                      {flag.contract} · {meta.shortName}
                    </strong>
                    <small>
                      {contract?.vendor} · {assigned ? `Assigned: ${assigned.name}` : "Unassigned"}
                    </small>
                  </span>
                  <Icon name="chevron" size={15} />
                </button>
              );
            })
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Audit Signals & Rule Evaluations"
          icon="file"
          subtitle="Click any case row to inspect evidence or assign an auditor in the Reviewer Workbench"
          action={
            <button className="text-button" onClick={() => go("flags")}>
              Open Flag Registry ({flags.length}) →
            </button>
          }
        />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Case ID</th>
                <th>Contract</th>
                <th>Vendor</th>
                <th>Triggered Rule</th>
                <th>Assigned Auditor</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => {
                const c = contracts.find((item) => item.id === f.contract);
                const status = decisions[f.id]?.status || f.status;
                const meta = getRuleMeta(status === "RESOLVED_BY_AMENDMENT" ? "RULE_3_AMENDMENT_RES" : f.rule);
                const assignedAud = AUDITORS.find((a) => a.uid === assignments[f.id]);
                return (
                  <tr key={f.id} onClick={() => selectFlag(f.id)}>
                    <td>
                      <strong style={{ color: "#1d4ed8" }}>{f.id}</strong>
                    </td>
                    <td><code>{f.contract}</code></td>
                    <td style={{ fontWeight: 500, color: "#0f172a" }}>{c?.vendor}</td>
                    <td>
                      <span className="rule-pill">{meta.shortName}</span>
                    </td>
                    <td style={{ fontSize: "12.5px" }}>
                      {status === "RESOLVED_BY_AMENDMENT"
                        ? "System (Rule 3)"
                        : assignedAud
                        ? assignedAud.name
                        : "Unassigned"}
                    </td>
                    <td>
                      <StatusBadge status={status} small />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Workbench({
  flag,
  contractIdOverride,
  decisions,
  assignments,
  onAssignAuditor,
  onRecordDecision,
  selectFlag,
  selectContract,
  go,
}) {
  const { contracts, flags, invoices, payments, amendments, analyzeCase, hasLiveToken } = useAuditData();
  const [tab, setTab] = useState("Investigation");
  const [notes, setNotes] = useState("");
  const [modal, setModal] = useState(null);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisBusy, setAnalysisBusy] = useState(false);

  const effectiveContractId = contractIdOverride || flag?.contract || contracts[0]?.id;
  const selectedContract = useMemo(
    () => contracts.find((c) => c.id === effectiveContractId) || contracts[0],
    [contracts, effectiveContractId]
  );

  const contractFlags = useMemo(
    () => flags.filter((f) => f.contract === selectedContract?.id),
    [flags, selectedContract]
  );

  const [localFlagId, setLocalFlagId] = useState(flag?.id);

  useEffect(() => {
    if (flag && contractFlags.some((f) => f.id === flag.id)) {
      setLocalFlagId(flag.id);
    } else if (contractFlags.length > 0) {
      setLocalFlagId(contractFlags[0].id);
    } else {
      setLocalFlagId(null);
    }
    setNotes("");
    setError("");
    setModal(null);
    setTab("Investigation");
    setAnalysis(null);
    setAnalysisError("");
    setAnalysisBusy(false);
  }, [selectedContract, flag, contractFlags]);

  const associatedFlag = useMemo(() => {
    if (contractFlags.length === 0 || !localFlagId) return null;
    return contractFlags.find((f) => f.id === localFlagId) || contractFlags[0];
  }, [contractFlags, localFlagId]);

  const assignedAuditorUid = associatedFlag ? assignments[associatedFlag.id] || "" : "";
  const assignedAuditor = AUDITORS.find((a) => a.uid === assignedAuditorUid);

  const relatedInvoices = useMemo(
    () => invoices.filter((i) => i.contract === selectedContract?.id),
    [invoices, selectedContract]
  );
  const relatedPayments = useMemo(
    () => payments.filter((p) => p.contract === selectedContract?.id),
    [payments, selectedContract]
  );
  const relatedAmendments = useMemo(
    () => amendments.filter((a) => a.contract === selectedContract?.id),
    [amendments, selectedContract]
  );

  const eligibleInvoices = useMemo(
    () => getEligibleInvoices(selectedContract?.id, relatedInvoices),
    [selectedContract, relatedInvoices]
  );
  const cumulativeEligibleTotal = useMemo(
    () => eligibleInvoices.reduce((acc, curr) => acc + (curr.amount || 0), 0),
    [eligibleInvoices]
  );

  const contractCap = selectedContract?.cap || selectedContract?.value || 0;
  const originalContractValue = selectedContract?.originalCap || selectedContract?.value || 0;
  const variance = cumulativeEligibleTotal - contractCap;

  const resolvedAmendment = useMemo(
    () =>
      associatedFlag?.rule === "RULE_1_OVERBILL"
        ? getResolvedAmendment(selectedContract, relatedAmendments, cumulativeEligibleTotal, associatedFlag.rule)
        : null,
    [selectedContract, relatedAmendments, cumulativeEligibleTotal, associatedFlag]
  );

  const currentStatus = useMemo(() => {
    if (!associatedFlag) return "CLEAN";
    const localOverride = decisions[associatedFlag.id]?.status;
    if (localOverride) return localOverride;
    if (resolvedAmendment) return "RESOLVED_BY_AMENDMENT";
    return associatedFlag.status;
  }, [associatedFlag, decisions, resolvedAmendment]);

  const triggeringPayment = useMemo(() => {
    if (!associatedFlag?.record || associatedFlag.rule !== "RULE_2_TEMPORAL") return null;
    return relatedPayments.find((p) => p.id === associatedFlag.record) || null;
  }, [associatedFlag, relatedPayments]);

  const temporalDiscrepancyDays = useMemo(() => {
    if (!triggeringPayment || !selectedContract?.startDate || !triggeringPayment.date) return null;
    const contractStart = new Date(`${selectedContract.startDate}T00:00:00`);
    const payDate = new Date(`${triggeringPayment.date}T00:00:00`);
    const diffDays = Math.ceil((contractStart - payDate) / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : null;
  }, [triggeringPayment, selectedContract]);

  const currentFlagIndex = flags.findIndex((f) => f.id === associatedFlag?.id);
  const handleStepFlag = (dir) => {
    if (flags.length === 0) return;
    const nextIdx =
      currentFlagIndex === -1
        ? 0
        : (currentFlagIndex + dir + flags.length) % flags.length;
    const next = flags[nextIdx];
    selectContract(next.contract);
    selectFlag(next.id);
    setLocalFlagId(next.id);
  };

  const decide = () => {
    if (!notes.trim()) {
      setError("Auditor notes are required before confirming or dismissing a flag.");
      return;
    }
    if (associatedFlag) {
      onRecordDecision(associatedFlag.id, modal, notes);
    }
    setModal(null);
    setError("");
    setNotes("");
  };

  const runAnalysis = async () => {
    if (!associatedFlag) return;
    setAnalysisBusy(true);
    setAnalysisError("");
    try {
      const result = await analyzeCase(associatedFlag.id);
      if (result) setAnalysis(result);
      else setAnalysisError("AI analysis needs a live backend connection.");
    } catch (thrown) {
      setAnalysisError(thrown?.message || "AI analysis failed.");
    } finally {
      setAnalysisBusy(false);
    }
  };

  const ruleMeta = getRuleMeta(
    currentStatus === "RESOLVED_BY_AMENDMENT" ? "RULE_3_AMENDMENT_RES" : associatedFlag?.rule
  );

  return (
    <div className="page-stack workbench">
      <div className="back-row">
        <button className="text-button" onClick={() => go("overview")}>
          <Icon name="chevron" className="flip" size={14} />
          Back to overview
        </button>
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <Select
            value={selectedContract?.id}
            onChange={(e) => {
              const cId = e.target.value;
              selectContract(cId);
              const matches = flags.filter((f) => f.contract === cId);
              if (matches.length > 0) {
                setLocalFlagId(matches[0].id);
                selectFlag(matches[0].id);
              } else {
                setLocalFlagId(null);
              }
            }}
            options={contracts.map((c) => {
              const f = flags.find((item) => item.contract === c.id);
              const st = f ? decisions[f.id]?.status || f.status : "CLEAN";
              return {
                value: c.id,
                label: `${c.id} · ${c.vendor} (${st.replaceAll("_", " ")})`,
              };
            })}
          />
          <button className="button" onClick={() => handleStepFlag(-1)} title="Previous flagged case">
            ← Prev Case
          </button>
          <button className="button" onClick={() => handleStepFlag(1)} title="Next flagged case">
            Next Case →
          </button>
        </div>
      </div>

      <Card className="contract-banner">
        <div className="contract-main">
          <div className="contract-icon">
            <Icon name="file" size={20} />
          </div>
          <div>
            <div className="contract-title">
              <h2>
                {selectedContract?.id} — {selectedContract?.title}
              </h2>
              <StatusBadge status={currentStatus} />
              {associatedFlag && <SeverityBadge severity={associatedFlag.severity} />}
            </div>
            <p>
              <strong>{selectedContract?.vendor}</strong>
              <i />
              Department: {selectedContract?.department}
              <i />
              Term: {formatDate(selectedContract?.startDate)} – {formatDate(selectedContract?.endDate)}
            </p>
          </div>
        </div>

        {/* Auditor Assignment Control */}
        <div className="assigned">
          <span className="avatar">{assignedAuditor ? assignedAuditor.initials : "?"}</span>
          <div>
            <small style={{ display: "block", marginBottom: "3px" }}>Assigned Auditor</small>
            {associatedFlag ? (
              <select
                value={assignedAuditorUid}
                onChange={(e) => onAssignAuditor(associatedFlag.id, e.target.value)}
                style={{
                  border: "1px solid #cbd5e1",
                  borderRadius: "6px",
                  padding: "4px 8px",
                  fontSize: "12.5px",
                  fontWeight: 600,
                  background: "#f8fafc",
                  color: "#0f172a",
                }}
              >
                <option value="">Unassigned (Select Auditor)</option>
                {AUDITORS.map((aud) => (
                  <option key={aud.uid} value={aud.uid}>
                    {aud.name} — {aud.role}
                  </option>
                ))}
              </select>
            ) : (
              <strong>No Flag Assigned</strong>
            )}
          </div>
        </div>
      </Card>

      <div className="tabs">
        {[
          ["Investigation", "search"],
          ["Invoices & Vouchers", "file"],
          ["Contract Details", "file"],
          ["Disbursement Ledger", "card"],
          ["Audit Log", "history"],
        ].map(([n, i]) => (
          <button className={tab === n ? "active" : ""} onClick={() => setTab(n)} key={n}>
            <Icon name={i} size={15} />
            {n}
            {n === "Invoices & Vouchers" && <b>{relatedInvoices.length}</b>}
          </button>
        ))}
      </div>

      {tab === "Investigation" && (
        <>
          <div className="investigation-grid">
            <Card>
              <CardHeader
                title="Contract & Amendment Dossier"
                icon="file"
                subtitle="Authoritative ceiling and executed modifications"
              />
              <div className="dossier-sheet">
                <div className="dossier-box">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#64748b" }}>
                      Master Procurement Agreement
                    </span>
                    <code>{selectedContract?.id}</code>
                  </div>
                  <div className="dossier-grid">
                    <div>
                      <dt>Original Authorized Cap</dt>
                      <dd className="num">{formatMoney(originalContractValue)}</dd>
                    </div>
                    <div>
                      <dt>Current Active Cap</dt>
                      <dd className="num" style={{ color: "#1d4ed8" }}>
                        {formatMoney(contractCap)}
                      </dd>
                    </div>
                    <div>
                      <dt>Effective Start Date</dt>
                      <dd>{formatDate(selectedContract?.startDate)}</dd>
                    </div>
                    <div>
                      <dt>Expiration Date</dt>
                      <dd>{formatDate(selectedContract?.endDate)}</dd>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: "16px" }}>
                  <h4 style={{ fontSize: "12.5px", fontWeight: 600, marginBottom: "8px" }}>
                    Registered Contract Amendments ({relatedAmendments.length})
                  </h4>
                  {relatedAmendments.length === 0 ? (
                    <p style={{ fontSize: "12.5px", color: "#64748b", background: "#f8fafc", padding: "12px", borderRadius: "8px", border: "1px dashed #cbd5e1" }}>
                      No amendments filed for this contract. Original contract ceiling remains in effect.
                    </p>
                  ) : (
                    <div style={{ display: "grid", gap: "8px" }}>
                      {relatedAmendments.map((am) => (
                        <div
                          key={am.id}
                          style={{
                            border: "1px solid #e2e8f0",
                            borderRadius: "8px",
                            padding: "12px",
                            background: am.status === "Executed" ? "#ecfdf5" : "#fffbeb",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <strong style={{ fontSize: "13px" }}>{am.number}</strong>
                            <StatusBadge status={am.status} small />
                          </div>
                          <p style={{ fontSize: "12px", color: "#334155", margin: "4px 0" }}>{am.description}</p>
                          <div style={{ fontSize: "12px", fontWeight: 600 }}>
                            Revised Cap: {formatMoney(am.newCap)} · Effective: {formatDate(am.effectiveDate)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Card>

            {currentStatus === "RESOLVED_BY_AMENDMENT" || resolvedAmendment ? (
              <Card>
                <CardHeader
                  title="Rule 3 · Amendment Cap Resolution Analysis"
                  icon="check"
                  action={<span className="rule-pill">Rule 3 Verified</span>}
                />
                <div className="finance-summary">
                  <div>
                    <span>Original Cap</span>
                    <strong>{formatMoney(originalContractValue)}</strong>
                    <small>Initial ceiling</small>
                  </div>
                  <div>
                    <span>Amended Cap</span>
                    <strong>{formatMoney(resolvedAmendment?.newCap || contractCap)}</strong>
                    <small>{resolvedAmendment?.id || "Executed"}</small>
                  </div>
                  <div className="variance-ok">
                    <span>Remaining Headroom</span>
                    <strong>{formatMoney(contractCap - cumulativeEligibleTotal)}</strong>
                    <small>✓ Within amended cap</small>
                  </div>
                </div>
                <div style={{ padding: "0 18px 18px" }}>
                  <div
                    style={{
                      background: "#ecfdf5",
                      border: "1px solid #a7f3d0",
                      borderRadius: "8px",
                      padding: "12px 14px",
                      fontSize: "12.5px",
                      color: "#065f46",
                      marginBottom: "14px",
                    }}
                  >
                    <strong>Dynamic Resolution (Rule 3):</strong> Cumulative eligible invoices (
                    {formatMoney(cumulativeEligibleTotal)}) exceeded the original cap (
                    {formatMoney(originalContractValue)}), but executed amendment{" "}
                    <b>{resolvedAmendment?.id}</b> raised the ceiling to{" "}
                    <b>{formatMoney(contractCap)}</b>, automatically clearing the active exception while preserving full audit history.
                  </div>
                  <table className="compact-table">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th className="right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eligibleInvoices.map((i) => (
                        <tr key={i.id}>
                          <td><code>{i.number}</code></td>
                          <td>{formatDate(i.date)}</td>
                          <td><StatusBadge status={i.status} small /></td>
                          <td className="right num">{formatMoney(i.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : associatedFlag?.rule === "RULE_2_TEMPORAL" ? (
              <Card>
                <CardHeader
                  title="Rule 2 · Temporal Governance Analysis"
                  icon="clock"
                  action={<span className="rule-pill">Rule 2 Exception</span>}
                />
                <div className="finance-summary">
                  <div>
                    <span>Contract Start Date</span>
                    <strong style={{ fontSize: "16px" }}>{formatDate(selectedContract?.startDate)}</strong>
                    <small>Legal effective date</small>
                  </div>
                  <div>
                    <span>Disbursement Date</span>
                    <strong style={{ fontSize: "16px", color: "#be123c" }}>
                      {formatDate(triggeringPayment?.date)}
                    </strong>
                    <small>Voucher {triggeringPayment?.id}</small>
                  </div>
                  <div className="variance">
                    <span>Chronological Gap</span>
                    <strong>{temporalDiscrepancyDays ? `-${temporalDiscrepancyDays} days` : "Premature"}</strong>
                    <small>Paid before start</small>
                  </div>
                </div>
                <div style={{ padding: "0 18px 18px" }}>
                  <div
                    style={{
                      background: "#fff1f2",
                      border: "1px solid #fecdd3",
                      borderRadius: "8px",
                      padding: "12px 14px",
                      fontSize: "12.5px",
                      color: "#9f1239",
                      marginBottom: "14px",
                    }}
                  >
                    <strong>Temporal Breach (Rule 2):</strong> Treasury transfer{" "}
                    <b>{triggeringPayment?.id}</b> ({formatMoney(triggeringPayment?.amount)}) was executed{" "}
                    <b>{temporalDiscrepancyDays} days before</b> the contract's legal start date.
                  </div>
                  <table className="compact-table">
                    <thead>
                      <tr>
                        <th>Payment ID</th>
                        <th>Disbursement Date</th>
                        <th className="right">Amount Paid</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relatedPayments.map((p) => (
                        <tr key={p.id}>
                          <td><code>{p.id}</code></td>
                          <td>{formatDate(p.date)}</td>
                          <td className="right num">{formatMoney(p.amount)}</td>
                          <td><StatusBadge status={p.status} small /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : (
              <Card>
                <CardHeader
                  title="Rule 1 · Cumulative Cap & Over-Billing Analysis"
                  icon="chart"
                  action={<span className="rule-pill">{ruleMeta.shortName}</span>}
                />
                <div className="finance-summary">
                  <div>
                    <span>Authorized Cap</span>
                    <strong>{formatMoney(contractCap)}</strong>
                    <small>Active limit</small>
                  </div>
                  <div>
                    <span>Cumulative Billed</span>
                    <strong>{formatMoney(cumulativeEligibleTotal)}</strong>
                    <small>{eligibleInvoices.length} eligible invoices</small>
                  </div>
                  <div className={variance > 0 ? "variance" : "variance-ok"}>
                    <span>Cap Variance</span>
                    <strong>{variance > 0 ? `+${formatMoney(variance)}` : formatMoney(variance)}</strong>
                    <small>{variance > 0 ? "↑ Exceeds authorized cap" : "✓ Within authorized cap"}</small>
                  </div>
                </div>
                <h4 className="subheading">Cumulative Eligible Invoice Breakdown</h4>
                <div className="table-scroll">
                  <table className="compact-table">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Milestone</th>
                        <th>Date</th>
                        <th>Status</th>
                        <th className="right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eligibleInvoices.map((i) => (
                        <tr key={i.id}>
                          <td><code>{i.number}</code></td>
                          <td>{i.milestone}</td>
                          <td>{formatDate(i.date)}</td>
                          <td><StatusBadge status={i.status} small /></td>
                          <td className="right num">{formatMoney(i.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            <div className="right-rail">
              <Card>
                <CardHeader title="Exception Signal Metadata" icon="flag" />
                <dl className="detail-list">
                  <div>
                    <dt>Case Reference</dt>
                    <dd><code>{associatedFlag?.id || "CLEAN"}</code></dd>
                  </div>
                  <div>
                    <dt>Triggered Rule</dt>
                    <dd>{ruleMeta.shortName}</dd>
                  </div>
                  <div>
                    <dt>Trigger Voucher</dt>
                    <dd><code>{associatedFlag?.record || "None"}</code></dd>
                  </div>
                  <div>
                    <dt>Assigned Auditor</dt>
                    <dd>{assignedAuditor ? assignedAuditor.name : "Unassigned"}</dd>
                  </div>
                  <div>
                    <dt>Workflow Status</dt>
                    <dd>
                      <StatusBadge status={currentStatus} small />
                    </dd>
                  </div>
                </dl>
              </Card>

              {associatedFlag && (
                <Card>
                  <CardHeader
                    title="AI Case Analysis"
                    icon="note"
                    subtitle="A neutral draft summary of the recorded evidence — never a finding"
                  />
                  <div style={{ padding: "0 18px 18px" }}>
                    <button className="button" onClick={runAnalysis} disabled={!hasLiveToken || analysisBusy}>
                      <Icon name="note" size={15} />
                      <strong>{analysisBusy ? "Analyzing…" : "Analyze with AI"}</strong>
                    </button>
                    {!hasLiveToken && (
                      <small style={{ display: "block", marginTop: "8px", color: "#64748b" }}>
                        Connect the dashboard to the live API to run AI analysis.
                      </small>
                    )}
                    {analysisError && (
                      <span style={{ display: "block", marginTop: "10px", color: "#be123c", fontSize: "12.5px" }}>
                        {analysisError}
                      </span>
                    )}
                    {analysis && (
                      <div style={{ marginTop: "12px", display: "grid", gap: "10px" }}>
                        <p style={{ margin: 0, fontSize: "12.5px", color: "#334155" }}>{analysis.summary}</p>
                        {analysis.evidence_observations?.length > 0 && (
                          <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12.5px", color: "#334155" }}>
                            {analysis.evidence_observations.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ul>
                        )}
                        <div
                          style={{
                            background: "#fffbeb",
                            border: "1px solid #fde68a",
                            borderRadius: "8px",
                            padding: "10px 12px",
                            fontSize: "12px",
                            color: "#92400e",
                          }}
                        >
                          <strong>Limitation:</strong> {analysis.limitation}
                        </div>
                        <small style={{ color: "#64748b" }}>Model: {analysis.model}</small>
                      </div>
                    )}
                  </div>
                </Card>
              )}

              <div className="human-note">
                <Icon name="help" size={18} />
                <p>
                  <strong>Auditor Verification Standard</strong>
                  <span>
                    Deterministic flags highlight arithmetic or date anomalies. Always cross-check pending amendments and disbursement locks before recording a final determination.
                  </span>
                </p>
              </div>
            </div>
          </div>

          {associatedFlag ? (
            <Card>
              <CardHeader
                title="Auditor Determination & Sign-Off"
                icon="users"
                subtitle="Record your formal review findings. Notes are appended to the immutable investigation trail."
              />
              <div className="decision-body">
                <label className="notes-field">
                  <span>
                    Auditor determination notes <b>* required</b>
                  </span>
                  <textarea
                    value={notes}
                    onChange={(e) => {
                      setNotes(e.target.value);
                      setError("");
                    }}
                    maxLength={500}
                    placeholder="Document evidence inspected, amendment validity, and rationale for confirming or dismissing this signal…"
                  />
                  <small>{notes.length} / 500</small>
                  {error && (
                    <span style={{ display: "block", color: "#be123c", fontSize: "12px", marginTop: "4px" }}>
                      {error}
                    </span>
                  )}
                </label>
                <div className="decision-actions">
                  <span>Record auditor decision</span>
                  <div>
                    <button
                      className="button confirm"
                      disabled={currentStatus !== "ACTIVE"}
                      onClick={() => setModal("CONFIRMED")}
                    >
                      <Icon name="check" size={16} />
                      <strong>Confirm Exception</strong>
                    </button>
                    <button
                      className="button dismiss"
                      disabled={currentStatus !== "ACTIVE"}
                      onClick={() => setModal("DISMISSED")}
                    >
                      <Icon name="x" size={16} />
                      <strong>Dismiss Signal</strong>
                    </button>
                  </div>
                  {currentStatus !== "ACTIVE" && (
                    <small style={{ display: "block", marginTop: "8px", color: "#64748b" }}>
                      This case is currently in terminal status ({currentStatus.replaceAll("_", " ")}).
                    </small>
                  )}
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Compliant Contract — Zero Exceptions" icon="check" />
              <div style={{ padding: "18px", fontSize: "13.5px", color: "#334155" }}>
                All invoices and treasury disbursements for <strong>{selectedContract?.id}</strong> satisfy Rule 1, Rule 2, and Rule 3 controls.
              </div>
            </Card>
          )}
        </>
      )}

      {tab === "Invoices & Vouchers" && (
        <Records
          title="Linked Vendor Invoices"
          rows={relatedInvoices.map((inv) => [
            `${inv.number} (${inv.id})`,
            `Milestone ${inv.milestone} · Issued ${formatDate(inv.date)} · Status: ${inv.status}`,
            formatMoney(inv.amount),
          ])}
        />
      )}
      {tab === "Contract Details" && <ContractDetails contract={selectedContract} />}
      {tab === "Disbursement Ledger" && (
        <Records
          title="Treasury Payment Disbursements"
          rows={relatedPayments.map((p) => [
            p.id,
            `Invoice ${p.invoice} · Date: ${formatDate(p.date)} · ${p.status}`,
            formatMoney(p.amount),
          ])}
        />
      )}
      {tab === "Audit Log" && (
        <Card>
          <CardHeader title="Case Investigation Activity" icon="history" />
          <div style={{ padding: "18px" }}>
            {associatedFlag && decisions[associatedFlag.id] ? (
              <div style={{ padding: "12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>Determination Recorded: {decisions[associatedFlag.id].status}</strong>
                  <small>{new Date(decisions[associatedFlag.id].timestamp).toLocaleString()}</small>
                </div>
                <p style={{ marginTop: "6px", fontSize: "13px" }}>{decisions[associatedFlag.id].notes}</p>
              </div>
            ) : (
              <p style={{ color: "#64748b" }}>No new auditor actions recorded in this session yet.</p>
            )}
          </div>
        </Card>
      )}

      {modal && (
        <Modal
          title={modal === "CONFIRMED" ? "Confirm Audit Exception?" : "Dismiss Audit Signal?"}
          subtitle="This action will be logged in the Investigation History trail."
          onClose={() => {
            setModal(null);
            setError("");
          }}
          actions={
            <>
              <button className="button subtle" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                className={`button ${modal === "CONFIRMED" ? "confirm-solid" : "danger"}`}
                onClick={decide}
              >
                Confirm & Sign Off
              </button>
            </>
          }
        >
          <div className="decision-summary">
            <span>Case ID</span>
            <strong>{associatedFlag?.id} ({selectedContract?.id})</strong>
            <span>Rule Triggered</span>
            <span>{ruleMeta.shortName}</span>
            <span>Determination</span>
            <StatusBadge status={modal} />
            <span>Auditor Notes</span>
            <p>{notes}</p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ContractsPage({ go, decisions, globalSearch, selectContract }) {
  const { contracts, invoices, payments, flags } = useAuditData();
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [drawerContract, setDrawerContract] = useState(null);

  const enrichedContracts = useMemo(() => {
    return contracts.map((c) => {
      const cInvoices = invoices.filter((i) => i.contract === c.id);
      const cPayments = payments.filter((p) => p.contract === c.id);
      const totalInvoiced = cInvoices.reduce((s, i) => s + i.amount, 0);
      const totalPaid = cPayments.reduce((s, p) => s + p.amount, 0);
      const flag = flags.find((f) => f.contract === c.id);
      const effectiveStatus = flag ? decisions[flag.id]?.status || flag.status : "CLEAN";
      const utilization = c.cap > 0 ? Math.round((totalInvoiced / c.cap) * 100) : 0;
      return {
        ...c,
        totalInvoiced,
        totalPaid,
        utilization,
        flag,
        effectiveStatus,
      };
    });
  }, [contracts, invoices, payments, flags, decisions]);

  const filtered = enrichedContracts.filter((c) => {
    const q = (globalSearch || "").toLowerCase();
    const matchesSearch =
      !q ||
      c.id.toLowerCase().includes(q) ||
      c.vendor.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.department.toLowerCase().includes(q);
    const matchesStatus = statusFilter === "ALL" || c.effectiveStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="page-stack">
      <Card>
        <CardHeader
          title="Procurement Contracts Registry"
          icon="file"
          subtitle={`Showing ${filtered.length} of ${contracts.length} public-sector contracts`}
        />
        <div className="filter-bar">
          <div className="pill-tabs">
            {[
              ["ALL", `All Contracts (${contracts.length})`],
              ["ACTIVE", `Active Flag (${enrichedContracts.filter((c) => c.effectiveStatus === "ACTIVE").length})`],
              ["RESOLVED_BY_AMENDMENT", `Amended (${enrichedContracts.filter((c) => c.effectiveStatus === "RESOLVED_BY_AMENDMENT").length})`],
              ["CLEAN", `Clean (${enrichedContracts.filter((c) => c.effectiveStatus === "CLEAN").length})`],
            ].map(([val, label]) => (
              <button
                key={val}
                className={`pill-tab ${statusFilter === val ? "active" : ""}`}
                onClick={() => setStatusFilter(val)}
              >
                {label}
              </button>
            ))}
          </div>
          {globalSearch && (
            <span style={{ fontSize: "12px", color: "#64748b" }}>
              Filtered by search: <strong>“{globalSearch}”</strong>
            </span>
          )}
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Contract ID</th>
                <th>Vendor & Procurement Title</th>
                <th className="right">Authorized Cap</th>
                <th className="right">Total Invoiced</th>
                <th>Cap Utilization</th>
                <th>Term</th>
                <th>Audit Posture</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const barColor =
                  c.utilization > 100 ? "#e11d48" : c.effectiveStatus === "RESOLVED_BY_AMENDMENT" ? "#d97706" : "#059669";
                return (
                  <tr key={c.id} onClick={() => setDrawerContract(c)}>
                    <td>
                      <strong style={{ color: "#1d4ed8" }}>{c.id}</strong>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: "#0f172a" }}>{c.vendor}</div>
                      <div style={{ fontSize: "12px", color: "#64748b" }}>{c.title}</div>
                    </td>
                    <td className="right num" style={{ fontWeight: 600 }}>
                      {formatMoney(c.cap)}
                      {c.cap !== c.originalCap && (
                        <div style={{ fontSize: "11px", color: "#b45309" }}>
                          Orig: {formatMoney(c.originalCap)}
                        </div>
                      )}
                    </td>
                    <td className="right num">{formatMoney(c.totalInvoiced)}</td>
                    <td>
                      <div className="util-wrap">
                        <div className="util-track">
                          <div
                            className="util-fill"
                            style={{ width: `${Math.min(c.utilization, 100)}%`, background: barColor }}
                          />
                        </div>
                        <span className="num" style={{ fontSize: "12px", fontWeight: 600, color: barColor }}>
                          {c.utilization}%
                        </span>
                      </div>
                    </td>
                    <td style={{ fontSize: "12.5px" }}>
                      {formatDate(c.startDate)} – {formatDate(c.endDate)}
                    </td>
                    <td>
                      <StatusBadge status={c.effectiveStatus} small />
                    </td>
                    <td>
                      <Icon name="chevron" size={15} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {drawerContract && (
        <div className="drawer-backdrop" onClick={() => setDrawerContract(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase" }}>
                  Contract Dossier · {drawerContract.department}
                </span>
                <h2 style={{ fontSize: "20px", fontWeight: 700, marginTop: "4px" }}>
                  {drawerContract.id} — {drawerContract.vendor}
                </h2>
                <p style={{ fontSize: "13px", color: "#64748b", marginTop: "2px" }}>{drawerContract.title}</p>
              </div>
              <button className="icon-button" onClick={() => setDrawerContract(null)}>
                <Icon name="x" size={16} />
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: "10px",
                margin: "18px 0",
                padding: "14px",
                background: "#f8fafc",
                borderRadius: "9px",
                border: "1px solid #e2e8f0",
              }}
            >
              <div>
                <small style={{ color: "#64748b", fontSize: "11px" }}>Authorized Cap</small>
                <div className="num" style={{ fontSize: "17px", fontWeight: 700 }}>
                  {formatMoney(drawerContract.cap)}
                </div>
              </div>
              <div>
                <small style={{ color: "#64748b", fontSize: "11px" }}>Total Billed</small>
                <div className="num" style={{ fontSize: "17px", fontWeight: 700 }}>
                  {formatMoney(drawerContract.totalInvoiced)}
                </div>
              </div>
              <div>
                <small style={{ color: "#64748b", fontSize: "11px" }}>Total Disbursed</small>
                <div className="num" style={{ fontSize: "17px", fontWeight: 700 }}>
                  {formatMoney(drawerContract.totalPaid)}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: "18px" }}>
              <strong style={{ fontSize: "12.5px", display: "block", marginBottom: "6px" }}>
                Verification Notes
              </strong>
              <p style={{ fontSize: "13px", color: "#334155", background: "#f8fafc", padding: "10px 12px", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
                {drawerContract.notes}
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button
                className="button primary"
                onClick={() => {
                  const id = drawerContract.id;
                  setDrawerContract(null);
                  selectContract(id);
                  go("workbench");
                }}
              >
                Inspect in Reviewer Workbench →
              </button>
              <button className="button" onClick={() => setDrawerContract(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FlagsPage({ decisions, assignments, onAssignAuditor, globalSearch, selectFlag }) {
  const { flags } = useAuditData();
  const [ruleFilter, setRuleFilter] = useState("ALL");

  const filtered = flags.filter((f) => {
    const status = decisions[f.id]?.status || f.status;
    const query = (globalSearch || "").toLowerCase();
    const matchesQuery =
      !query ||
      f.id.toLowerCase().includes(query) ||
      f.contract.toLowerCase().includes(query) ||
      f.evidence.toLowerCase().includes(query) ||
      status.toLowerCase().includes(query);
    const matchesRule =
      ruleFilter === "ALL" ||
      (ruleFilter === "RULE_3" ? status === "RESOLVED_BY_AMENDMENT" : f.rule === ruleFilter);
    return matchesQuery && matchesRule;
  });

  return (
    <Card>
      <CardHeader
        title="Audit Flags & Rule Signals"
        icon="flag"
        subtitle="Assign auditors and manage deterministic verification exceptions"
      />
      <div className="filter-bar">
        <div className="pill-tabs">
          {[
            ["ALL", `All Signals (${flags.length})`],
            ["RULE_1_OVERBILL", "Rule 1 · Cap Overrun"],
            ["RULE_2_TEMPORAL", "Rule 2 · Pre-Effective Payment"],
            ["RULE_3", "Rule 3 · Resolved by Amendment"],
          ].map(([val, label]) => (
            <button
              key={val}
              className={`pill-tab ${ruleFilter === val ? "active" : ""}`}
              onClick={() => setRuleFilter(val)}
            >
              {label}
            </button>
          ))}
        </div>
        {globalSearch && (
          <span style={{ fontSize: "12px", color: "#64748b" }}>
            Filtered by search: <strong>“{globalSearch}”</strong>
          </span>
        )}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Case ID</th>
              <th>Contract</th>
              <th>Rule Applied</th>
              <th>Assigned Auditor</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((f) => {
              const currentStatus = decisions[f.id]?.status || f.status;
              const meta = getRuleMeta(
                currentStatus === "RESOLVED_BY_AMENDMENT" ? "RULE_3_AMENDMENT_RES" : f.rule
              );
              return (
                <tr key={f.id} onClick={() => selectFlag(f.id)}>
                  <td>
                    <strong style={{ color: "#1d4ed8" }}>{f.id}</strong>
                  </td>
                  <td><code>{f.contract}</code></td>
                  <td>
                    <span className="rule-pill">{meta.shortName}</span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {currentStatus === "RESOLVED_BY_AMENDMENT" ? (
                      <span style={{ fontSize: "12px", color: "#64748b" }}>System (Rule 3)</span>
                    ) : (
                      <select
                        value={assignments[f.id] || ""}
                        onChange={(e) => onAssignAuditor(f.id, e.target.value)}
                        style={{
                          border: "1px solid #cbd5e1",
                          borderRadius: "6px",
                          padding: "4px 8px",
                          fontSize: "12px",
                          background: "#ffffff",
                        }}
                      >
                        <option value="">Unassigned</option>
                        {AUDITORS.map((aud) => (
                          <option key={aud.uid} value={aud.uid}>
                            {aud.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <SeverityBadge severity={f.severity} />
                  </td>
                  <td>
                    <StatusBadge status={currentStatus} small />
                  </td>
                  <td>
                    <span className="text-button">Review →</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Analytics({ decisions }) {
  const { flags, contracts, payments, invoices } = useAuditData();
  const confirmed = flags.filter((f) => (decisions[f.id]?.status || f.status) === "CONFIRMED").length;
  const dismissed = flags.filter((f) => (decisions[f.id]?.status || f.status) === "DISMISSED").length;
  const resolved = flags.filter((f) => (decisions[f.id]?.status || f.status) === "RESOLVED_BY_AMENDMENT").length;

  const totalAuthorizedCap = contracts.reduce((s, c) => s + c.cap, 0);
  const totalDisbursed = payments.reduce((s, p) => s + p.amount, 0);
  const blockedAmount = flags
    .filter((f) => f.rule === "RULE_1_OVERBILL" && (decisions[f.id]?.status || f.status) === "ACTIVE")
    .reduce((s, f) => s + (f.amount || 0), 0);

  const rule1Count = flags.filter((f) => f.rule === "RULE_1_OVERBILL" && f.status === "ACTIVE").length;
  const rule2Count = flags.filter((f) => f.rule === "RULE_2_TEMPORAL").length;

  const sla = useMemo(() => {
    const DAY_MS = 86400000;
    const today = new Date().toISOString().slice(0, 10);
    const toIso = (value) => (value ? String(value).slice(0, 10) : "");
    const diffDays = (from, to) =>
      from && to ? Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) : null;
    const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

    const rows = flags.map((f) => {
      const decision = decisions[f.id];
      const status = decision?.status || f.status;
      const completed = decision?.timestamp
        ? toIso(decision.timestamp)
        : toIso(f.completedAt || (status === "RESOLVED_BY_AMENDMENT" ? f.resolvedAt : ""));
      const created = toIso(f.created);
      const started = toIso(f.startedAt);
      const due = toIso(f.dueAt);
      let slaState = { label: "—", className: "severity-low" };
      if (completed && due) {
        slaState =
          completed <= due
            ? { label: "Met", className: "severity-low" }
            : { label: "Breached", className: "severity-critical" };
      } else if (completed) {
        slaState = { label: "—", className: "severity-low" };
      } else if (due) {
        slaState =
          due < today
            ? { label: `Overdue ${diffDays(due, today)}d`, className: "severity-critical" }
            : { label: `Due in ${diffDays(today, due)}d`, className: "severity-medium" };
      }
      const cycle = completed ? diffDays(created, completed) : diffDays(created, today);
      return { id: f.id, contract: f.contract, rule: f.rule, severity: f.severity || "MEDIUM", status, created, started, due, completed, cycle, slaState };
    });

    const completedRows = rows.filter((r) => r.completed);
    const openRows = rows.filter((r) => !r.completed);
    const cycleTimes = completedRows.map((r) => diffDays(r.created, r.completed)).filter((n) => n !== null);
    const sortedCycle = [...cycleTimes].sort((a, b) => a - b);
    const medianCycle = sortedCycle.length
      ? sortedCycle.length % 2
        ? sortedCycle[(sortedCycle.length - 1) / 2]
        : (sortedCycle[sortedCycle.length / 2 - 1] + sortedCycle[sortedCycle.length / 2]) / 2
      : 0;

    const overdue = openRows.filter((r) => r.due && r.due < today);
    const dueSoon = openRows.filter((r) => r.due && r.due >= today && diffDays(today, r.due) <= 2);
    const breached = completedRows.filter((r) => r.due && r.completed > r.due).length;
    const attainment = completedRows.length
      ? Math.round(((completedRows.length - breached) / completedRows.length) * 100)
      : 100;

    const avgTriage = average(rows.map((r) => diffDays(r.created, r.started)).filter((n) => n !== null && n >= 0));
    const avgInvestigate = average(rows.map((r) => diffDays(r.started, r.completed)).filter((n) => n !== null && n >= 0));
    const awaitingTriage = openRows.filter((r) => !r.started).length;
    const inInvestigation = openRows.filter((r) => r.started).length;
    const avgAge = average(openRows.map((r) => diffDays(r.created, today)).filter((n) => n !== null));

    // Monthly burndown: cases still open at the end of each month.
    const dates = rows.flatMap((r) => [r.created, r.completed]).filter(Boolean).sort();
    const firstMonth = (dates[0] || today).slice(0, 7);
    const lastMonth = (dates[dates.length - 1] || today).slice(0, 7);
    const endMonth = lastMonth > today.slice(0, 7) ? lastMonth : today.slice(0, 7);
    const burndown = [];
    const cursor = new Date(`${firstMonth}-01T00:00:00Z`);
    const stop = new Date(`${endMonth}-01T00:00:00Z`);
    while (cursor <= stop && burndown.length < 18) {
      const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
      const monthEnd = new Date(next.getTime() - DAY_MS).toISOString().slice(0, 10);
      const opened = rows.filter((r) => r.created && r.created <= monthEnd).length;
      const done = rows.filter((r) => r.completed && r.completed <= monthEnd).length;
      burndown.push({ label: cursor.toLocaleString("en-US", { month: "short" }), remaining: Math.max(opened - done, 0) });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    return {
      rows,
      openRows,
      completedRows,
      avgCycle: average(cycleTimes),
      medianCycle,
      overdue,
      dueSoon,
      breached,
      attainment,
      avgTriage,
      avgInvestigate,
      awaitingTriage,
      inInvestigation,
      avgAge,
      burndown,
      throughput: (completedRows.length / Math.max(burndown.length, 1)).toFixed(1),
      completedCount: completedRows.length,
    };
  }, [flags, decisions]);

  return (
    <div className="page-stack">
      <div className="kpi-grid">
        <Card className="kpi">
          <div className="kpi-icon blue">
            <Icon name="chart" size={18} />
          </div>
          <div>
            <span>Total Authorized Cap</span>
            <strong>{formatMoney(totalAuthorizedCap)}</strong>
            <small>Includes +$350k executed amendments</small>
          </div>
        </Card>
        <Card className="kpi">
          <div className="kpi-icon green">
            <Icon name="card" size={18} />
          </div>
          <div>
            <span>Total Disbursed</span>
            <strong>{formatMoney(totalDisbursed)}</strong>
            <small>{Math.round((totalDisbursed / totalAuthorizedCap) * 100)}% of authorized portfolio</small>
          </div>
        </Card>
        <Card className="kpi">
          <div className="kpi-icon red">
            <Icon name="flag" size={18} />
          </div>
          <div>
            <span>Disbursements Blocked</span>
            <strong>{formatMoney(blockedAmount)}</strong>
            <small>Held automatically by Rule 1 locks</small>
          </div>
        </Card>
        <Card className="kpi">
          <div className="kpi-icon amber">
            <Icon name="check" size={18} />
          </div>
          <div>
            <span>False-Positive Reduction</span>
            <strong>{Math.round((resolved / flags.length) * 100)}%</strong>
            <small>{resolved} of {flags.length} flags cleared via Rule 3</small>
          </div>
        </Card>
      </div>

      <div className="section-heading">
        <div>
          <h2>Review-Batch SLA, Cycle Time &amp; Burndown</h2>
          <p>Lifecycle timestamps, cycle-time distribution, monthly burndown, overdue exposure, and stage bottlenecks</p>
        </div>
      </div>

      <div className="kpi-grid">
        <Card className="kpi">
          <div className="kpi-icon blue">
            <Icon name="clock" size={18} />
          </div>
          <div>
            <span>Average Cycle Time</span>
            <strong>{sla.avgCycle.toFixed(1)} d</strong>
            <small>{sla.completedCount} resolved cases · created → completed</small>
          </div>
        </Card>
        <Card className="kpi">
          <div className="kpi-icon slate">
            <Icon name="chart" size={18} />
          </div>
          <div>
            <span>Median Cycle Time</span>
            <strong>{sla.medianCycle.toFixed(1)} d</strong>
            <small>Half of the batch closes faster than this</small>
          </div>
        </Card>
        <Card className="kpi">
          <div className="kpi-icon green">
            <Icon name="check" size={18} />
          </div>
          <div>
            <span>SLA Attainment</span>
            <strong>{sla.attainment}%</strong>
            <small>
              {sla.breached} of {sla.completedCount} resolved past due
            </small>
          </div>
        </Card>
        <Card className="kpi">
          <div className="kpi-icon red">
            <Icon name="flag" size={18} />
          </div>
          <div>
            <span>Overdue Cases</span>
            <strong>{sla.overdue.length}</strong>
            <small>{sla.dueSoon.length} more due within 2 days</small>
          </div>
        </Card>
      </div>

      <div className="analytics-grid">
        <Card>
          <CardHeader
            title="Review Burndown"
            icon="chart"
            subtitle="Cases still open at the end of each month"
            action={<span style={{ fontSize: 12, color: "var(--muted)" }}>Throughput {sla.throughput}/mo</span>}
          />
          <div className="horizontal-bars">
            {(() => {
              const max = Math.max(...sla.burndown.map((p) => p.remaining), 1);
              return sla.burndown.map((point, index) => (
                <div key={`${point.label}-${index}`}>
                  <span>{point.label}</span>
                  <div>
                    <i
                      style={{
                        width: `${point.remaining > 0 ? Math.max((point.remaining / max) * 100, 8) : 0}%`,
                        background: point.remaining > 0 ? "#1d4ed8" : "#cbd5e1",
                      }}
                    />
                  </div>
                  <strong>{point.remaining}</strong>
                </div>
              ));
            })()}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Stage Bottlenecks"
            icon="clock"
            subtitle="Average days spent in each review stage"
          />
          <div className="horizontal-bars">
            {(() => {
              const stages = [
                ["Triage · created → started", sla.avgTriage, "#ea580c"],
                ["Investigation · started → resolved", sla.avgInvestigate, "#e11d48"],
                ["Open backlog · current age", sla.avgAge, "#1d4ed8"],
              ];
              const max = Math.max(...stages.map((stage) => stage[1]), 1);
              return stages.map(([label, value, color]) => (
                <div key={label}>
                  <span>{label}</span>
                  <div>
                    <i
                      style={{
                        width: `${value > 0 ? Math.max((value / max) * 100, 8) : 0}%`,
                        background: color,
                      }}
                    />
                  </div>
                  <strong>{value.toFixed(1)}d</strong>
                </div>
              ));
            })()}
          </div>
          <div className="legend-row">
            <span>
              <i className="orange" /> {sla.awaitingTriage} awaiting triage
            </span>
            <span>
              <i className="red" /> {sla.inInvestigation} in investigation
            </span>
            <span>
              <i className="blue" /> {sla.openRows.length} open of {sla.rows.length}
            </span>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Case Cycle-Time & SLA Register"
          icon="flag"
          subtitle="Created, started, due and completed timestamps with per-case SLA outcome"
        />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Case</th>
                <th>Contract</th>
                <th>Rule</th>
                <th>Severity</th>
                <th>Created</th>
                <th>Started</th>
                <th>Due</th>
                <th>Completed</th>
                <th className="right">Cycle</th>
                <th>SLA</th>
              </tr>
            </thead>
            <tbody>
              {sla.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <code>{row.id}</code>
                  </td>
                  <td>
                    <code>{row.contract}</code>
                  </td>
                  <td>{getRuleMeta(row.rule).shortName}</td>
                  <td>
                    <SeverityBadge severity={row.severity} />
                  </td>
                  <td>{row.created ? formatDate(row.created) : "—"}</td>
                  <td>{row.started ? formatDate(row.started) : "—"}</td>
                  <td>{row.due ? formatDate(row.due) : "—"}</td>
                  <td>{row.completed ? formatDate(row.completed) : "—"}</td>
                  <td className="right num">{row.cycle === null ? "—" : `${row.cycle}d`}</td>
                  <td>
                    <span className={`severity ${row.slaState.className}`}>{row.slaState.label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="analytics-grid">
        <Card>
          <CardHeader
            title="Rule Trigger & Outcome Breakdown"
            icon="flag"
            subtitle="Deterministic verification signals across the portfolio"
          />
          <div className="horizontal-bars">
            {[
              ["Rule 1 · Cap Overrun (Active)", rule1Count, "#e11d48"],
              ["Rule 2 · Pre-Effective Payment", rule2Count, "#ea580c"],
              ["Rule 3 · Amendment Resolved", resolved, "#d97706"],
              ["Auditor Confirmed", confirmed, "#059669"],
              ["Auditor Dismissed", dismissed, "#64748b"],
            ].map(([label, count, color]) => (
              <div key={label}>
                <span>{label}</span>
                <div>
                  <i style={{ width: `${Math.max((count / flags.length) * 100, count > 0 ? 12 : 0)}%`, background: color }} />
                </div>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Cap Utilization by Contract"
            icon="chart"
            subtitle="Billed amount relative to current authorized ceiling"
          />
          <div className="horizontal-bars" style={{ maxHeight: "260px", overflowY: "auto" }}>
            {contracts.map((c) => {
              const billed = invoices.filter((i) => i.contract === c.id).reduce((s, i) => s + i.amount, 0);
              const pct = Math.round((billed / c.cap) * 100);
              const color = pct > 100 ? "#e11d48" : c.status === "RESOLVED_BY_AMENDMENT" ? "#d97706" : "#1d4ed8";
              return (
                <div key={c.id}>
                  <span>
                    <code>{c.id}</code>
                  </span>
                  <div>
                    <i style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
                  </div>
                  <strong style={{ color }}>{pct}%</strong>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Portfolio Financial Reconciliation Matrix"
          icon="file"
          subtitle="Complete contract-by-contract breakdown of caps, cumulative billing, disbursements, and rule posture"
        />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Contract</th>
                <th>Vendor</th>
                <th className="right">Original Cap</th>
                <th className="right">Current Cap</th>
                <th className="right">Invoiced</th>
                <th className="right">Disbursed</th>
                <th>Posture</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => {
                const invSum = invoices.filter((i) => i.contract === c.id).reduce((s, i) => s + i.amount, 0);
                const paySum = payments.filter((p) => p.contract === c.id).reduce((s, p) => s + p.amount, 0);
                const f = flags.find((item) => item.contract === c.id);
                const status = f ? decisions[f.id]?.status || f.status : "CLEAN";
                return (
                  <tr key={c.id}>
                    <td><code>{c.id}</code></td>
                    <td style={{ fontWeight: 500, color: "#0f172a" }}>{c.vendor}</td>
                    <td className="right num">{formatMoney(c.originalCap)}</td>
                    <td className="right num" style={{ fontWeight: 600 }}>{formatMoney(c.cap)}</td>
                    <td className="right num" style={{ color: invSum > c.cap ? "#be123c" : "inherit", fontWeight: invSum > c.cap ? 700 : 400 }}>
                      {formatMoney(invSum)}
                    </td>
                    <td className="right num">{formatMoney(paySum)}</td>
                    <td><StatusBadge status={status} small /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function HistoryPage({ decisions, assignmentLogs, globalSearch }) {
  const { flags, auditHistory } = useAuditData();
  const combinedHistory = useMemo(() => {
    const humanEntries = Object.entries(decisions).map(([caseId, data], i) => {
      const f = flags.find((item) => item.id === caseId);
      return {
        id: `HUMAN-${i + 1}`,
        caseId,
        contractId: f?.contract || "Unknown",
        auditor: data.auditor || "Urvashi R.",
        action: data.status === "CONFIRMED" ? "Auditor Confirmed Exception" : "Auditor Dismissed Signal",
        fromStatus: "ACTIVE",
        toStatus: data.status,
        timestamp: data.timestamp,
        note: data.notes,
      };
    });
    const normalizedInitial = auditHistory.map((item) => ({
      ...item,
      auditor: item.auditor || item.actor,
    }));
    return [...humanEntries, ...assignmentLogs, ...normalizedInitial];
  }, [decisions, assignmentLogs, flags, auditHistory]);

  const filteredHistory = combinedHistory.filter((evt) => {
    const q = (globalSearch || "").toLowerCase();
    if (!q) return true;
    return (
      evt.caseId.toLowerCase().includes(q) ||
      evt.contractId.toLowerCase().includes(q) ||
      (evt.auditor || "").toLowerCase().includes(q) ||
      evt.note.toLowerCase().includes(q)
    );
  });

  return (
    <Card>
      <CardHeader
        title="Investigation & Accountability Audit Trail"
        icon="history"
        subtitle="Chronological log of automated rule engine triggers, auditor assignments, and determinations"
      />
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Case ID</th>
              <th>Contract</th>
              <th>Auditor / Engine</th>
              <th>Action</th>
              <th>Status</th>
              <th>Timestamp</th>
              <th>Audit Rationale</th>
            </tr>
          </thead>
          <tbody>
            {filteredHistory.map((evt) => (
              <tr key={evt.id}>
                <td><code>{evt.caseId}</code></td>
                <td><code>{evt.contractId}</code></td>
                <td style={{ fontWeight: 600 }}>{evt.auditor}</td>
                <td>{evt.action}</td>
                <td>
                  <StatusBadge status={evt.toStatus} small />
                </td>
                <td style={{ fontSize: "12px", color: "#64748b" }}>
                  {new Date(evt.timestamp).toLocaleString()}
                </td>
                <td style={{ maxWidth: "420px", whiteSpace: "normal", fontSize: "12.5px" }}>{evt.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Records({ title, rows }) {
  return (
    <Card>
      <CardHeader title={title} icon="file" subtitle="Linked procurement voucher records" />
      <div className="record-grid">
        {rows.map((r, idx) => (
          <button key={idx} onClick={() => {}}>
            <span className="record-icon">
              <Icon name="file" size={18} />
            </span>
            <span>
              <strong>{r[0]}</strong>
              <small>{r[1]}</small>
            </span>
            <b>{r[2]}</b>
          </button>
        ))}
      </div>
    </Card>
  );
}

function ContractDetails({ contract }) {
  return (
    <Card>
      <CardHeader title="Master Contract Metadata" icon="file" />
      <dl className="detail-list two-col" style={{ padding: "18px" }}>
        {[
          ["Contract ID", contract?.id || "N/A"],
          ["Procurement Title", contract?.title || "N/A"],
          ["Department", contract?.department || "N/A"],
          ["Vendor Entity", contract?.vendor || "N/A"],
          ["Effective Term", `${formatDate(contract?.startDate)} to ${formatDate(contract?.endDate)}`],
          ["Original Authorized Cap", formatMoney(contract?.originalCap || 0)],
          ["Current Active Cap", formatMoney(contract?.cap || 0)],
          ["Audit Notes", contract?.notes || "None"],
        ].map((r, i) => (
          <div key={i}>
            <dt>{r[0]}</dt>
            <dd>{r[1]}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}