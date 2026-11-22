import Icon from "./Icon";

export function StatusBadge({ status, small = false }) {
  const normalized = status?.toUpperCase().replaceAll(" ", "_");
  const labels = {
    RESOLVED_BY_AMENDMENT: "Resolved by Amendment",
    COMPLIANT: "Compliant",
    CLEAN: "Clean",
    ACTIVE: "Active Flag",
    CONFIRMED: "Confirmed",
    DISMISSED: "Dismissed",
    AMENDED: "Amended",
    EXECUTED: "Executed",
    PENDING_APPROVAL: "Pending Approval",
    APPROVED: "Approved",
    FLAGGED: "Flagged",
    COMPLETED: "Completed",
  };
  const label = labels[normalized] || status?.replaceAll("_", " ");
  return (
    <span className={`status status-${normalized?.toLowerCase()} ${small ? "status-small" : ""}`}>
      <span className="status-dot" />
      {label}
    </span>
  );
}

export function SeverityBadge({ severity }) {
  return <span className={`severity severity-${severity?.toLowerCase()}`}>{severity}</span>;
}

export function Card({ children, className = "" }) {
  return <section className={`card ${className}`}>{children}</section>;
}

export function CardHeader({ title, icon, action, subtitle }) {
  return (
    <div className="card-header">
      <div>
        <h3>
          {icon && <Icon name={icon} size={17} />} {title}
        </h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Empty({
  title = "No matching records",
  message = "Try adjusting your search or filters.",
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name="search" size={22} />
      </div>
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

export function MiniBars({ values, labels, colors }) {
  const max = Math.max(...values, 1);
  return (
    <div className="mini-chart">
      <div className="bars">
        {values.map((v, i) => (
          <div className="bar-slot" key={labels[i]}>
            <span className="bar-value">{v}</span>
            <div
              className="bar"
              style={{
                height: `${Math.max((v / max) * 100, v > 0 ? 10 : 4)}%`,
                background: colors?.[i],
              }}
            />
            <span>{labels[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Donut({ primary = 68, color = "#00689D", label = "68%", caption = "Confirmed" }) {
  return (
    <div className="donut-wrap">
      <div className="donut" style={{ "--percent": `${primary * 3.6}deg`, "--donut-color": color }}>
        <div>
          <strong>{label}</strong>
          <span>{caption}</span>
        </div>
      </div>
    </div>
  );
}

export function Select({ value, onChange, options, children, ariaLabel }) {
  return (
    <label className="select-wrap">
      <select value={value} onChange={onChange} aria-label={ariaLabel}>
        {options
          ? options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))
          : children}
      </select>
      <Icon name="down" size={14} />
    </label>
  );
}

export function SearchBox({ value, onChange, placeholder = "Search…", compact = false }) {
  return (
    <label className={`search-box ${compact ? "compact" : ""}`}>
      <Icon name="search" size={16} />
      <input value={value} onChange={onChange} placeholder={placeholder} />
      {value && (
        <button
          type="button"
          onClick={() => onChange({ target: { value: "" } })}
          aria-label="Clear search"
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </label>
  );
}

export function Modal({
  title,
  subtitle = "This decision will be recorded in the investigation history.",
  icon = "flag",
  children,
  onClose,
  actions,
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div className="modal-icon">
            <Icon name={icon} size={19} />
          </div>
          <div>
            <h2 id="modal-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close modal">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-actions">{actions}</div>
      </div>
    </div>
  );
}