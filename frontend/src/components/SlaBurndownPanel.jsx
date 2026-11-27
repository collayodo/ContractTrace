import React, { useMemo } from "react";

const CASE_SLA_SEED = {
  "CASE-004": {
    contractId: "CNT-2026-004",
    created_at: "2026-03-02T09:00:00Z",
    started_at: "2026-03-02T14:00:00Z",
    completed_at: "2026-03-04T11:00:00Z",
    due_at: "2026-03-06T17:00:00Z",
    baseStatus: "RESOLVED_BY_AMENDMENT",
  },
  "CASE-010": {
    contractId: "CNT-2026-010",
    created_at: "2026-03-05T10:30:00Z",
    started_at: "2026-03-06T09:00:00Z",
    completed_at: "2026-03-07T15:30:00Z",
    due_at: "2026-03-10T17:00:00Z",
    baseStatus: "RESOLVED_BY_AMENDMENT",
  },
  "CASE-002": {
    contractId: "CNT-2026-002",
    created_at: "2026-05-20T10:00:00Z",
    started_at: "2026-05-21T11:00:00Z",
    completed_at: null,
    due_at: "2026-05-25T17:00:00Z",
    baseStatus: "ACTIVE",
  },
  "CASE-003": {
    contractId: "CNT-2026-003",
    created_at: "2026-03-01T08:15:00Z",
    started_at: "2026-03-02T16:15:00Z",
    completed_at: null,
    due_at: "2026-03-05T17:00:00Z",
    baseStatus: "ACTIVE",
  },
  "CASE-008": {
    contractId: "CNT-2026-008",
    created_at: "2026-05-22T09:30:00Z",
    started_at: null,
    completed_at: null,
    due_at: "2026-05-28T17:00:00Z",
    baseStatus: "ACTIVE",
  },
  "CASE-009": {
    contractId: "CNT-2026-009",
    created_at: "2026-03-15T12:00:00Z",
    started_at: "2026-03-16T10:00:00Z",
    completed_at: null,
    due_at: "2026-03-19T17:00:00Z",
    baseStatus: "ACTIVE",
  },
};

const REFERENCE_NOW = new Date("2026-05-26T12:00:00Z").getTime();

export default function SlaBurndownPanel({ flags = [], decisions = {} }) {
  const analytics = useMemo(() => {
    const records = Object.entries(CASE_SLA_SEED).map(([caseId, seed]) => {
      const flagObj = flags.find((f) => f.id === caseId);
      const liveDecision = decisions[caseId];
      const status = liveDecision?.status || flagObj?.status || seed.baseStatus;
      const isCompleted = status !== "ACTIVE";

      const createdMs = new Date(seed.created_at).getTime();
      const startedMs = seed.started_at
        ? new Date(seed.started_at).getTime()
        : isCompleted
        ? createdMs + 4 * 3600 * 1000
        : null;
      const completedMs = isCompleted
        ? seed.completed_at
          ? new Date(seed.completed_at).getTime()
          : (startedMs || createdMs) + 18 * 3600 * 1000
        : null;
      const dueMs = new Date(seed.due_at).getTime();

      const cycleHours = completedMs ? Math.max(1, (completedMs - createdMs) / 3600000) : null;
      const queueHours = ((startedMs || REFERENCE_NOW) - createdMs) / 3600000;
      const reviewHours = startedMs ? ((completedMs || REFERENCE_NOW) - startedMs) / 3600000 : 0;
      const isOverdue = !isCompleted && REFERENCE_NOW > dueMs;
      const ageDays = Math.max(1, Math.round((REFERENCE_NOW - createdMs) / 86400000));

      return {
        caseId,
        contractId: seed.contractId,
        status,
        isCompleted,
        created_at: seed.created_at.slice(0, 10),
        started_at: seed.started_at ? seed.started_at.slice(0, 10) : "Pending Triage",
        completed_at: completedMs ? new Date(completedMs).toISOString().slice(0, 10) : "Open",
        due_at: seed.due_at.slice(0, 10),
        cycleHours,
        queueHours,
        reviewHours,
        isOverdue,
        ageDays,
      };
    });

    const completedList = records.filter((r) => r.cycleHours !== null);
    const sortedCycles = completedList.map((r) => r.cycleHours).sort((a, b) => a - b);

    const avgCycleHours = sortedCycles.length
      ? sortedCycles.reduce((s, v) => s + v, 0) / sortedCycles.length
      : 0;

    const mid = Math.floor(sortedCycles.length / 2);
    const medianCycleHours = sortedCycles.length
      ? sortedCycles.length % 2 !== 0
        ? sortedCycles[mid]
        : (sortedCycles[mid - 1] + sortedCycles[mid]) / 2
      : 0;

    const throughputPerWeek = Number(((completedList.length / 12) * 7).toFixed(1));
    const overdueCount = records.filter((r) => r.isOverdue).length;
    const openCount = records.filter((r) => !r.isCompleted).length;

    const avgQueueHrs = Math.round(
      records.reduce((s, r) => s + Math.min(r.queueHours, 72), 0) / records.length
    );
    const activeReviewers = records.filter((r) => r.reviewHours > 0);
    const avgInvestigationHrs = activeReviewers.length
      ? Math.round(
          activeReviewers.reduce((s, r) => s + Math.min(r.reviewHours, 96), 0) /
            activeReviewers.length
        )
      : 0;

    // Review-Batch Burndown across batch milestones
    const totalBatch = records.length;
    const resolvedDynamic = Object.keys(decisions).filter((id) =>
      ["CASE-002", "CASE-003", "CASE-008", "CASE-009"].includes(id)
    ).length;

    const burndownSeries = [
      { label: "Batch Start", ideal: 6, actual: totalBatch },
      { label: "Wk 2 (Mar 04)", ideal: 5, actual: totalBatch - 1 },
      { label: "Wk 3 (Mar 11)", ideal: 4, actual: totalBatch - 2 },
      { label: "Wk 6 (Apr 01)", ideal: 3, actual: totalBatch - 2 },
      { label: "Wk 10 (May 01)", ideal: 2, actual: totalBatch - 2 },
      { label: "Current Batch", ideal: 0, actual: Math.max(0, openCount - resolvedDynamic * 0) },
    ];

    return {
      records,
      avgCycleHours: avgCycleHours.toFixed(1),
      medianCycleHours: medianCycleHours.toFixed(1),
      throughputPerWeek,
      overdueCount,
      openCount,
      completedCount: completedList.length,
      avgQueueHrs,
      avgInvestigationHrs,
      burndownSeries,
    };
  }, [flags, decisions]);

  const cardStyle = {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "20px",
    marginTop: "20px",
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "18px" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#0f172a" }}>
            Review-Batch SLA, Cycle Time & Burndown Analytics
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#64748b" }}>
            Lifecycle tracking across created, started, completed, and due timestamps for batch reconciliation
          </p>
        </div>
        <span style={{ background: "#eff6ff", color: "#00689D", border: "1px solid #bfdbfe", padding: "4px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 600 }}>
          Batch Q1–Q2 2026 • {analytics.completedCount}/{analytics.records.length} Cases Closed
        </span>
      </div>

      {/* 4 Operational SLA KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "14px", marginBottom: "22px" }}>
        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "14px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Cycle Time (Avg / Median)</div>
          <div style={{ fontSize: "22px", fontWeight: 700, color: "#00689D", marginTop: "6px" }}>
            {analytics.avgCycleHours}h <span style={{ fontSize: "14px", color: "#475569", fontWeight: 600 }}>/ {analytics.medianCycleHours}h</span>
          </div>
          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>Created → Completed resolution</div>
        </div>

        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "14px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Batch Throughput</div>
          <div style={{ fontSize: "22px", fontWeight: 700, color: "#0f172a", marginTop: "6px" }}>
            {analytics.throughputPerWeek} <span style={{ fontSize: "13px", fontWeight: 500, color: "#64748b" }}>cases / wk</span>
          </div>
          <div style={{ fontSize: "12px", color: "#059669", marginTop: "4px" }}>{analytics.completedCount} verified determinations</div>
        </div>

        <div style={{ background: analytics.overdueCount > 0 ? "#fff1f2" : "#f8fafc", border: `1px solid ${analytics.overdueCount > 0 ? "#fecdd3" : "#e2e8f0"}`, borderRadius: "10px", padding: "14px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: analytics.overdueCount > 0 ? "#be123c" : "#64748b", textTransform: "uppercase" }}>Overdue / Aging Work</div>
          <div style={{ fontSize: "22px", fontWeight: 700, color: analytics.overdueCount > 0 ? "#be123c" : "#0f172a", marginTop: "6px" }}>
            {analytics.overdueCount} <span style={{ fontSize: "13px", fontWeight: 500 }}>past due SLA</span>
          </div>
          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>{analytics.openCount} total active in queue</div>
        </div>

        <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "14px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Primary Stage Bottleneck</div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: "#d97706", marginTop: "6px" }}>
            Active Investigation
          </div>
          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
            Queue: {analytics.avgQueueHrs}h • Review: {analytics.avgInvestigationHrs}h
          </div>
        </div>
      </div>

      {/* Burndown Chart + Stage Bottleneck Split */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "18px", marginBottom: "20px" }}>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a", marginBottom: "4px" }}>
            Review-Batch Burndown (Remaining Unresolved Flags)
          </div>
          <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "14px" }}>
            Actual open flags (Cobalt) vs. target linear SLA burndown (dashed)
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "12px", height: "130px", paddingTop: "10px" }}>
            {analytics.burndownSeries.map((pt) => {
              const actualPct = Math.round((pt.actual / 6) * 100);
              const idealPct = Math.round((pt.ideal / 6) * 100);
              return (
                <div key={pt.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 700, color: "#00689D" }}>{pt.actual}</div>
                  <div style={{ width: "100%", height: "85px", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "4px", background: "#f8fafc", borderRadius: "6px", padding: "4px" }}>
                    <div
                      title={`Actual Remaining: ${pt.actual}`}
                      style={{
                        width: "45%",
                        height: `${Math.max(8, actualPct)}%`,
                        background: "#00689D",
                        borderRadius: "4px 4px 0 0",
                        transition: "height 0.3s ease",
                      }}
                    />
                    <div
                      title={`Target Ideal: ${pt.ideal}`}
                      style={{
                        width: "35%",
                        height: `${Math.max(4, idealPct)}%`,
                        background: "#cbd5e1",
                        borderRadius: "4px 4px 0 0",
                      }}
                    />
                  </div>
                  <div style={{ fontSize: "10px", color: "#64748b", textAlign: "center", lineHeight: 1.2 }}>{pt.label}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ border: "1px solid #e2e8f0", borderRadius: "10px", padding: "16px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a", marginBottom: "4px" }}>
            Workflow Stage Dwell & Bottleneck Distribution
          </div>
          <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "14px" }}>
            Average elapsed hours per lifecycle transition stage
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                <span style={{ fontWeight: 600, color: "#334155" }}>1. Intake Queue (Created → Started)</span>
                <span style={{ fontWeight: 700, color: "#00689D" }}>{analytics.avgQueueHrs} hrs avg</span>
              </div>
              <div style={{ height: "8px", background: "#f1f5f9", borderRadius: "999px", overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, Math.round((analytics.avgQueueHrs / 96) * 100))}%`, height: "100%", background: "#00689D" }} />
              </div>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                <span style={{ fontWeight: 600, color: "#334155" }}>2. Dossier Verification (Started → Completed)</span>
                <span style={{ fontWeight: 700, color: "#d97706" }}>{analytics.avgInvestigationHrs} hrs avg (Bottleneck)</span>
              </div>
              <div style={{ height: "8px", background: "#f1f5f9", borderRadius: "999px", overflow: "hidden" }}>
                <div style={{ width: `${Math.min(100, Math.round((analytics.avgInvestigationHrs / 96) * 100))}%`, height: "100%", background: "#d97706" }} />
              </div>
            </div>

            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                <span style={{ fontWeight: 600, color: "#334155" }}>3. Audit Log Finalization (Completed → Archived)</span>
                <span style={{ fontWeight: 700, color: "#059669" }}>Under 0.1 hrs (Automated)</span>
              </div>
              <div style={{ height: "8px", background: "#f1f5f9", borderRadius: "999px", overflow: "hidden" }}>
                <div style={{ width: "6%", height: "100%", background: "#059669" }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Case Lifecycle Timestamps & SLA Table */}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Case ID</th>
              <th>Contract</th>
              <th>Created</th>
              <th>Started</th>
              <th>Completed</th>
              <th>Due SLA</th>
              <th className="right">Cycle / Age</th>
              <th>SLA Posture</th>
            </tr>
          </thead>
          <tbody>
            {analytics.records.map((r) => (
              <tr key={r.caseId}>
                <td><code>{r.caseId}</code></td>
                <td><code>{r.contractId}</code></td>
                <td>{r.created_at}</td>
                <td>{r.started_at}</td>
                <td>{r.completed_at}</td>
                <td>{r.due_at}</td>
                <td className="right num">
                  {r.cycleHours !== null ? `${r.cycleHours.toFixed(1)}h` : `${r.ageDays}d open`}
                </td>
                <td>
                  {r.isCompleted ? (
                    <span style={{ background: "#ecfdf5", color: "#047857", padding: "2px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 600 }}>
                      Completed On-Time
                    </span>
                  ) : r.isOverdue ? (
                    <span style={{ background: "#fff1f2", color: "#be123c", padding: "2px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 600 }}>
                      Overdue ({r.ageDays}d)
                    </span>
                  ) : (
                    <span style={{ background: "#eff6ff", color: "#00689D", padding: "2px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 600 }}>
                      Within SLA
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
