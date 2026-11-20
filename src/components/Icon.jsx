import React from "react";

// ═════════════════════════════════════════════════════════════════════════════
// C762 — ONE SET OF PLAIN LINE ICONS FOR THE WHOLE APP. The screens used picture emojis (🧾 🏦 📋 📷
// 🤝 🎉 …) as icons; on a phone they render as colourful cartoons and read as unprofessional
// (operator, 2026-11-20). Every icon is now a 24×24 stroke drawing in `currentColor`, so it takes the
// colour of the text around it and matches the tab bar's icons (NavIcon.jsx). An unknown name
// renders nothing — never a fallback emoji.
// ═════════════════════════════════════════════════════════════════════════════
const P = {
  document: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9 12h6M9 16h6" /></>,
  receipt: <><path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  bank: <><path d="M3 10 12 4l9 6" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 20h18" /></>,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5h6v2" /><path d="M3 13h18" /></>,
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="M9 10h6M9 14h6" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 18 5-5 4 4 3-3 4 4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  inbox: <><path d="M3 13l3-8h12l3 8v6H3z" /><path d="M3 13h5l1.5 2.5h5L16 13h5" /></>,
  folder: <><path d="M3 6h6l2 2h10v11H3z" /></>,
  upload: <><path d="M12 16V5" /><path d="m7 10 5-5 5 5" /><path d="M5 19h14" /></>,
  download: <><path d="M12 5v11" /><path d="m7 11 5 5 5-5" /><path d="M5 19h14" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  paperclip: <><path d="M20 11.5 12.5 19a5 5 0 0 1-7-7L13 4.5a3.3 3.3 0 0 1 4.7 4.7l-7.6 7.6a1.7 1.7 0 0 1-2.4-2.4l7-7" /></>,
  alert: <><path d="M12 4 2.5 20h19z" /><path d="M12 10v4.5" /><path d="M12 17.5v.01" /></>,
  bell: <><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9" /><path d="M10 20.5a2.2 2.2 0 0 0 4 0" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M2 20h20" /></>,
  trend: <><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  building: <><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3" /></>,
  store: <><path d="M4 9 5.5 4h13L20 9" /><path d="M4 9h16a3 3 0 0 1-5.3 1.9A3 3 0 0 1 12 12a3 3 0 0 1-2.7-1.1A3 3 0 0 1 4 9" /><path d="M5.5 12v8h13v-8" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14a6.5 6.5 0 0 1 3 6" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 7 8.5-7" /></>,
  phone: <><path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2" /></>,
  note: <><path d="M5 3h10l4 4v14H5z" /><path d="M8 13l7-7 2 2-7 7H8z" /></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  zap: <><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></>,
  check: <><circle cx="12" cy="12" r="8.5" /><path d="m8 12 3 3 5-6" /></>,
  ban: <><circle cx="12" cy="12" r="8.5" /><path d="m6 6 12 12" /></>,
  flag: <><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>,
  coins: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12" /><circle cx="12" cy="12" r="3" /></>,
  chat: <><path d="M4 5h16v11H9l-5 4z" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M4.2 6.2l2.1 2.1M17.7 15.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 17.8l2.1-2.1M17.7 8.3l2.1-2.1" /></>,
  pause: <><circle cx="12" cy="12" r="8.5" /><path d="M10 9v6M14 9v6" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5v.7" /><path d="M12 17v.01" /></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></>,
  box: <><path d="m12 3 8.5 4.5v9L12 21l-8.5-4.5v-9z" /><path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9" /></>,
  sparkle: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></>,
  return: <><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>,
};

export const ICON_NAMES = Object.keys(P);

export default function Icon({ name, size = 18, style, title, strokeWidth = 1.8 }) {
  const p = P[name];
  if (!p) return null;
  return (
    <svg className="sc-icon" data-icon={name} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : "true"}
      style={{ flexShrink: 0, verticalAlign: "-0.2em", ...style }}>
      {title ? <title>{title}</title> : null}{p}
    </svg>
  );
}

// The icon for a document, from its stored type and file kind (the library, the entry panel, the preview).
export function docIconName(type = "", mediaType = "") {
  const mt = String(mediaType || "").toLowerCase();
  if (mt.startsWith("image/")) return "image";
  if (type === "invoice" || type === "receipt") return "receipt";
  if (type === "bank_statement") return "bank";
  if (type === "payroll") return "briefcase";
  if (type === "contract") return "clipboard";
  return "document";
}
