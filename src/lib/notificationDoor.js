// ─────────────────────────────────────────────────────────────────────────────
// C381 — WHERE A NOTIFICATION TAKES THE PERSON WHO CLICKED IT.
//
// The bell is ONE stored list per company (`notifications`), written by whichever session
// generated the row and read by everyone on the company. So a row carrying `link_view:
// "recon"` — authored for the accountant — is clicked by the owner too, and until C381
// `openNotification` did a bare `setView(n.link_view)`: the route guard then bounced the
// owner Home with "Your accountant looks after that part". The alert said *do this*; the
// click said *that isn't yours*. Same sentence, two answers, one tap apart (O124's rule:
// a control that refuses on click teaches you that clicking is how you find out).
//
// ★ THE LINK IS RESOLVED FOR THE SEAT THAT CLICKED, AT CLICK TIME. The stored row keeps the
// accountant's door; a seat that may not open it lands on Home, where the waiting-on-you
// list (U1) carries the owner's version of the same fact with the owner's action. No bounce,
// no toast about a screen they never asked for.
//
// Pure — the seat's view list is what `navRedirect` reads, so the two cannot disagree.
// ─────────────────────────────────────────────────────────────────────────────
import { canSeeView } from "./nav";

export function notificationTarget(n = {}, seatOpts = {}) {
  const link = typeof n?.link_view === "string" ? n.link_view : "";
  if (link.startsWith("txn:")) return { kind: "txn", id: link.slice(4) };
  if (link && canSeeView(link, seatOpts)) return { kind: "view", view: link };
  return { kind: "view", view: "home" };
}
