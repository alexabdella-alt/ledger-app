import React from "react";
import { downloadCSV } from "../lib/insights";

// ─────────────────────────────────────────────────────────────────────────────
// Inline AI outputs rendered inside a chat bubble: bar/pie/line charts, a metric
// summary card, and a CSV download button. Dependency-free (inline SVG) so it
// adds no bundle weight and matches the app's design system.
// ─────────────────────────────────────────────────────────────────────────────

const money = n => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
const SLICE_COLORS = ["var(--sc-gold)", "var(--sc-gold)", "var(--sc-gold)", "var(--sc-gold)", "var(--sc-gold)", "var(--sc-gold-soft)"];
const OTHER_COLOR = "var(--sc-text-mut)";

// Group a data array down to `max` slices, rolling the remainder into "Other".
function capSlices(data, max = 6) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1);
  const other = rest.reduce((s, d) => s + d.value, 0);
  return [...head, { label: "Other", value: other }];
}

const truncLabel = (s, max) => { const t = String(s); return t.length > max ? t.slice(0, max - 1) + "…" : t; };

// Horizontal bar chart — the standard, most readable layout for named category /
// vendor comparisons in a narrow panel: bars run left→right, full category names
// sit on the left (no rotation), and the dollar value sits at the end of each bar.
// Height scales with the number of categories (≈40px/bar, minimum 200px).
function BarChart({ data }) {
  const rows = [...data].sort((a, b) => b.value - a.value).slice(0, 8);
  const max = Math.max(1, ...rows.map(d => d.value));
  const [hover, setHover] = React.useState(-1);
  const height = Math.max(200, rows.length * 40);
  return (
    <div style={{ display: "flex", flexDirection: "column", height, padding: "2px 0" }}>
      {rows.map((d, i) => {
        const pct = Math.max(2, (d.value / max) * 100);
        const inside = pct > 62; // long bar → tuck the value inside, right-aligned in white
        return (
          <div key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)}
            style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <div title={d.label} style={{ width: 118, flexShrink: 0, fontSize: 11, color: "var(--sc-text-2)", textAlign: "right", lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{d.label}</div>
            <div style={{ flex: 1, minWidth: 0, position: "relative", height: 20, background: "var(--sc-surface-2)", borderRadius: 5 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: hover === i ? "var(--sc-gold)" : "var(--sc-gold)", borderRadius: 5, transition: "background .12s" }} />
              <span style={{
                position: "absolute", top: 0, height: 20, display: "flex", alignItems: "center",
                fontSize: 10.5, fontWeight: 600, fontFamily: "'DM Mono',monospace", whiteSpace: "nowrap", pointerEvents: "none",
                ...(inside ? { right: 8, color: "var(--sc-on-accent)" } : { left: `calc(${pct}% + 6px)`, color: "var(--sc-text)" }),
              }}>{money(d.value)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Pie/donut with external labels and leader lines (labels truncated to 12 chars),
// so names sit outside the slices instead of crowding a side legend.
function PieChart({ data }) {
  const slices = capSlices(data, 6).filter(d => d.value > 0);
  const total = slices.reduce((s, d) => s + d.value, 0) || 1;
  const [hover, setHover] = React.useState(-1);
  const W = 320, H = 190, cx = 160, cy = 95, r = 58;
  const polar = (deg, rad) => { const a = (deg - 90) * Math.PI / 180; return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]; };
  let acc = 0;
  const items = slices.map((d, i) => {
    const start = (acc / total) * 360; acc += d.value; const end = (acc / total) * 360;
    const mid = (start + end) / 2;
    const [x1, y1] = polar(start, r), [x2, y2] = polar(end, r);
    const large = end - start > 180 ? 1 : 0;
    const [ex, ey] = polar(mid, r);          // slice edge
    const [lx, ly] = polar(mid, r + 12);     // elbow
    const right = Math.cos((mid - 90) * Math.PI / 180) >= 0;
    const anchorX = right ? lx + 6 : lx - 6;
    return {
      path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`,
      color: d.label === "Other" ? OTHER_COLOR : SLICE_COLORS[i % SLICE_COLORS.length],
      ex, ey, lx, ly, right, anchorX, label: d.label, value: d.value, pct: (d.value / total) * 100,
    };
  });
  return (
    <div style={{ padding: "2px" }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }}>
        {items.map((it, i) => (
          <path key={i} d={it.path} fill={it.color} stroke="var(--sc-surface)" strokeWidth="1.5"
            opacity={hover === -1 || hover === i ? 1 : 0.4}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)} style={{ cursor: "default" }} />
        ))}
        {items.map((it, i) => (
          <g key={"l" + i} opacity={hover === -1 || hover === i ? 1 : 0.35}>
            <polyline points={`${it.ex},${it.ey} ${it.lx},${it.ly} ${it.anchorX},${it.ly}`} fill="none" stroke="var(--sc-border-2)" strokeWidth="1" />
            <text x={it.right ? it.anchorX + 3 : it.anchorX - 3} y={it.ly - 1} fontSize="9" fill="var(--sc-text-2)" textAnchor={it.right ? "start" : "end"}>{truncLabel(it.label, 12)}</text>
            <text x={it.right ? it.anchorX + 3 : it.anchorX - 3} y={it.ly + 9} fontSize="8.5" fontWeight="600" fill="var(--sc-text)" textAnchor={it.right ? "start" : "end"} fontFamily="'DM Mono',monospace">{money(it.value)} · {Math.round(it.pct)}%</text>
          </g>
        ))}
      </svg>
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
        <path d={area} fill="var(--sc-gold)" opacity="0.08" />
        <path d={line} fill="none" stroke="var(--sc-gold)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((d, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(d.value)} r={hover === i ? 5 : 3} fill="var(--sc-gold)" stroke="var(--sc-surface)" strokeWidth="1.5"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)} />
            <text x={x(i)} y={H - 9} fontSize="9" fill="var(--sc-text-mut)" textAnchor="middle">{String(d.label).slice(0, 7)}</text>
          </g>
        ))}
      </svg>
      {hover >= 0 && (
        <div style={{ position: "absolute", top: 0, left: `${(hover / (pts.length - 1)) * 100}%`, transform: "translateX(-50%)", background: "var(--sc-text)", color: "var(--sc-on-accent)", fontSize: 10, padding: "3px 7px", borderRadius: 6, whiteSpace: "nowrap", pointerEvents: "none" }}>
          {pts[hover].label}: {money(pts[hover].value)}
        </div>
      )}
    </div>
  );
}

const TREND = {
  up: { icon: "↑", color: "var(--sc-error)" },        // expenses up = bad/red by default
  down: { icon: "↓", color: "var(--sc-success)" },
  flat: { icon: "→", color: "var(--sc-text-mut)" },
  stable: { icon: "→", color: "var(--sc-text-mut)" },
};

function SummaryCard({ title, metrics, notes }) {
  return (
    <div>
      {title && <div style={{ fontSize: 13, fontWeight: 700, color: "var(--sc-text)", marginBottom: 10 }}>{title}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {(metrics || []).slice(0, 8).map((m, i) => {
          const t = TREND[String(m.trend || "").toLowerCase()] || TREND.flat;
          return (
            <div key={i} style={{ background: "var(--sc-bg)", border: "1px solid var(--sc-border)", borderRadius: 10, padding: "9px 11px" }}>
              <div style={{ fontSize: 10.5, color: "var(--sc-text-2)", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "var(--sc-text)", fontFamily: "'DM Mono',monospace" }}>{m.value}</span>
                {m.trend && <span style={{ fontSize: 12, color: t.color, fontWeight: 700 }}>{t.icon}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {notes && <div style={{ fontSize: 12, color: "var(--sc-text-2)", lineHeight: 1.5, marginTop: 10, paddingTop: 9, borderTop: "1px solid var(--sc-border)" }}>{notes}</div>}
    </div>
  );
}

function Frame({ children }) {
  return (
    <div style={{ marginTop: 8, background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 12, padding: "12px 14px" }}>
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
              {item.title && <div style={{ fontSize: 13, fontWeight: 700, color: "var(--sc-text)", marginBottom: 10 }}>{item.title}</div>}
              {item.chart_type === "pie" ? <PieChart data={item.data} />
                : item.chart_type === "line" ? <LineChart data={item.data} />
                : <BarChart data={item.data} />}
              {item.report_view && (
                <button onClick={() => onNavigate && onNavigate(item.report_view)}
                  style={{ marginTop: 10, background: "none", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "5px 12px", color: "var(--sc-gold)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
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
              style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 8, background: "var(--sc-gold-soft)", border: "1px solid var(--sc-gold-soft)", borderRadius: 10, padding: "9px 14px", color: "var(--sc-gold)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              ⬇ Download {item.filename}
            </button>
          );
        }
        return null;
      })}
    </>
  );
}
