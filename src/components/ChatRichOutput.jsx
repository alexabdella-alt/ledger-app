import React from "react";
import { downloadCSV } from "../lib/insights";

// ─────────────────────────────────────────────────────────────────────────────
// Inline AI outputs rendered inside a chat bubble: bar/pie/line charts, a metric
// summary card, and a CSV download button. Dependency-free (inline SVG) so it
// adds no bundle weight and matches the app's design system.
// ─────────────────────────────────────────────────────────────────────────────

const money = n => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const SLICE_COLORS = ["#4F46E5", "#6366F1", "#818CF8", "#A5B4FC", "#C7D2FE", "#E0E7FF"];
const OTHER_COLOR = "#98A2B3";

// Group a data array down to `max` slices, rolling the remainder into "Other".
function capSlices(data, max = 6) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1);
  const other = rest.reduce((s, d) => s + d.value, 0);
  return [...head, { label: "Other", value: other }];
}

function BarChart({ data }) {
  const rows = [...data].sort((a, b) => b.value - a.value).slice(0, 8);
  const max = Math.max(1, ...rows.map(d => d.value));
  const [hover, setHover] = React.useState(-1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, padding: "4px 2px" }}>
      {rows.map((d, i) => (
        <div key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 96, fontSize: 11, color: "#475467", textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flexShrink: 0 }} title={d.label}>{d.label}</div>
          <div style={{ flex: 1, height: 18, background: "#F2F4F7", borderRadius: 5, overflow: "hidden" }}>
            <div style={{ width: `${Math.max(2, (d.value / max) * 100)}%`, height: "100%", background: hover === i ? "#4338CA" : "#4F46E5", borderRadius: 5, transition: "background .12s" }} />
          </div>
          <div style={{ width: 64, fontSize: 11, fontWeight: 600, color: "#101828", fontFamily: "'DM Mono',monospace", textAlign: "right", flexShrink: 0 }}>{money(d.value)}</div>
        </div>
      ))}
    </div>
  );
}

function PieChart({ data }) {
  const slices = capSlices(data, 6).filter(d => d.value > 0);
  const total = slices.reduce((s, d) => s + d.value, 0) || 1;
  const [hover, setHover] = React.useState(-1);
  const cx = 70, cy = 70, r = 60;
  const polar = (deg) => { const a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  let acc = 0;
  const paths = slices.map((d, i) => {
    const start = (acc / total) * 360;
    acc += d.value;
    const end = (acc / total) * 360;
    const [x1, y1] = polar(start), [x2, y2] = polar(end);
    const large = end - start > 180 ? 1 : 0;
    const color = d.label === "Other" ? OTHER_COLOR : SLICE_COLORS[i % SLICE_COLORS.length];
    return { d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`, color, pct: (d.value / total) * 100 };
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "4px 2px" }}>
      <svg width="140" height="140" viewBox="0 0 140 140" style={{ flexShrink: 0 }}>
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.color} stroke="#FFFFFF" strokeWidth="1.5"
            opacity={hover === -1 || hover === i ? 1 : 0.45}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)} style={{ cursor: "default" }} />
        ))}
      </svg>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
        {slices.map((d, i) => (
          <div key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, opacity: hover === -1 || hover === i ? 1 : 0.5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: d.label === "Other" ? OTHER_COLOR : SLICE_COLORS[i % SLICE_COLORS.length], flexShrink: 0 }} />
            <span style={{ color: "#475467", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={d.label}>{d.label}</span>
            <span style={{ color: "#101828", fontWeight: 600, fontFamily: "'DM Mono',monospace", flexShrink: 0 }}>{money(d.value)}</span>
            <span style={{ color: "#98A2B3", width: 34, textAlign: "right", flexShrink: 0 }}>{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChart({ data }) {
  const pts = data.filter(d => d && d.value != null);
  const [hover, setHover] = React.useState(-1);
  if (pts.length < 2) return <BarChart data={data} />;
  const W = 360, H = 150, padX = 8, padTop = 12, padBot = 26;
  const max = Math.max(1, ...pts.map(d => d.value));
  const min = Math.min(0, ...pts.map(d => d.value));
  const span = max - min || 1;
  const x = i => padX + (i / (pts.length - 1)) * (W - padX * 2);
  const y = v => padTop + (1 - (v - min) / span) * (H - padTop - padBot);
  const line = pts.map((d, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`).join(" ");
  const area = `${line} L ${x(pts.length - 1).toFixed(1)} ${(H - padBot).toFixed(1)} L ${x(0).toFixed(1)} ${(H - padBot).toFixed(1)} Z`;
  return (
    <div style={{ position: "relative", padding: "4px 2px" }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: "block" }}>
        <path d={area} fill="#4F46E5" opacity="0.08" />
        <path d={line} fill="none" stroke="#4F46E5" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((d, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(d.value)} r={hover === i ? 5 : 3} fill="#4F46E5" stroke="#FFFFFF" strokeWidth="1.5"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)} />
            <text x={x(i)} y={H - 9} fontSize="9" fill="#98A2B3" textAnchor="middle">{String(d.label).slice(0, 7)}</text>
          </g>
        ))}
      </svg>
      {hover >= 0 && (
        <div style={{ position: "absolute", top: 0, left: `${(hover / (pts.length - 1)) * 100}%`, transform: "translateX(-50%)", background: "#101828", color: "#fff", fontSize: 10, padding: "3px 7px", borderRadius: 6, whiteSpace: "nowrap", pointerEvents: "none" }}>
          {pts[hover].label}: {money(pts[hover].value)}
        </div>
      )}
    </div>
  );
}

const TREND = {
  up: { icon: "↑", color: "#D92D20" },        // expenses up = bad/red by default
  down: { icon: "↓", color: "#039855" },
  flat: { icon: "→", color: "#98A2B3" },
  stable: { icon: "→", color: "#98A2B3" },
};

function SummaryCard({ title, metrics, notes }) {
  return (
    <div>
      {title && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#101828", marginBottom: 10 }}>{title}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {(metrics || []).slice(0, 8).map((m, i) => {
          const t = TREND[String(m.trend || "").toLowerCase()] || TREND.flat;
          return (
            <div key={i} style={{ background: "#F9FAFB", border: "1px solid #F0F1F4", borderRadius: 10, padding: "9px 11px" }}>
              <div style={{ fontSize: 10.5, color: "#475467", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#101828", fontFamily: "'DM Mono',monospace" }}>{m.value}</span>
                {m.trend && <span style={{ fontSize: 12, color: t.color, fontWeight: 700 }}>{t.icon}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {notes && <div style={{ fontSize: 11.5, color: "#475467", lineHeight: 1.5, marginTop: 10, paddingTop: 9, borderTop: "1px solid #F0F1F4" }}>{notes}</div>}
    </div>
  );
}

function Frame({ children }) {
  return (
    <div style={{ marginTop: 10, background: "#FFFFFF", border: "1px solid #E4E7EC", borderRadius: 12, padding: "12px 14px" }}>
      {children}
    </div>
  );
}

// Render the array of rich outputs attached to an assistant message.
export default function ChatRichOutput({ rich, onNavigate }) {
  if (!Array.isArray(rich) || rich.length === 0) return null;
  return (
    <>
      {rich.map((item, idx) => {
        if (item.kind === "chart") {
          return (
            <Frame key={idx}>
              {item.title && <div style={{ fontSize: 12.5, fontWeight: 700, color: "#101828", marginBottom: 10 }}>{item.title}</div>}
              {item.chart_type === "pie" ? <PieChart data={item.data} />
                : item.chart_type === "line" ? <LineChart data={item.data} />
                : <BarChart data={item.data} />}
              {item.report_view && (
                <button onClick={() => onNavigate && onNavigate(item.report_view)}
                  style={{ marginTop: 10, background: "none", border: "1px solid #D0D5DD", borderRadius: 8, padding: "5px 12px", color: "#4F46E5", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  View full report →
                </button>
              )}
            </Frame>
          );
        }
        if (item.kind === "summary") {
          return <Frame key={idx}><SummaryCard title={item.title} metrics={item.metrics} notes={item.notes} /></Frame>;
        }
        if (item.kind === "csv") {
          return (
            <button key={idx} onClick={() => downloadCSV(item.filename, item.headers, item.rows)}
              style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 8, background: "#EEF2FF", border: "1px solid #4F46E533", borderRadius: 10, padding: "9px 14px", color: "#4F46E5", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
              ⬇ Download {item.filename}
            </button>
          );
        }
        return null;
      })}
    </>
  );
}
