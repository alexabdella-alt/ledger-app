import React from "react";
import { fmtMoney, fmtDate, todayLocal } from "../../lib/format";
import { useERP } from "../ERPContext";
import LoadFailedNotice from "../LoadFailedNotice";
import { taxEstimate, getTaxDeadlines, deductionBreakdown, filedKey, taxYearFor1099, LEGAL_FORMS, taxProfileFrom } from "../../lib/tax";
import { FILING_STATUSES } from "../../lib/taxGuidance.js";
import { mileageRatesFor } from "../../lib/mileage.js";
import { plan1099, plan1099Copy, plan1099ForYear, tracker1099Rows } from "../../lib/form1099";
import { taxPacketRows, taxPacketFilename, TAX_PACKET_HEADERS } from "../../lib/taxPacket.js";
import { downloadCSV } from "../../lib/insights";
import { vendorGroupKey } from "../../lib/vendorIdentity";

export default function TaxView() {
  const { invoices, contacts, currentCompany, setView, showNotification, getAccountByRole, CHART_OF_ACCOUNTS, supabase, setFiledDeadlines, hasAttester, companySettings, saveLegalForm, taxAssets, bankAccounts, filedDeadlinesPrev, cutoffDate } = useERP();
  const fmt = fmtMoney;
  const year = new Date().getFullYear();
  const year1099 = taxYearFor1099();   // C549 — the year the next 1099 deadline is about
  // C693 — the device mirror is per YEAR: without the year, a new January showed last year's
  // estimated payments (and "Still owed" understated by them) until a row was saved.
  const lsKey = `cfai_tax_${currentCompany?.id || "x"}_${year}`;

  // Tax compliance state lives in Supabase (tax_settings). Falls back to the
  // legacy localStorage blob (and migrates it) or defaults until a row exists.
  const [taxState, setTaxState] = React.useState({ estPaid: 0, filed: {}, workFromHome: false });
  // C417 — did the read of the saved figures RUN? On a failed read the screen showed $0 of
  // estimated payments (and a "Still owed" inflated by the same amount), and a blur on the
  // input would have saved that 0 OVER the real figure. False → the box is replaced by a
  // notice and the save refuses.
  const [loadOk, setLoadOk] = React.useState(true);
  const rowExists = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentCompany?.id) return;
      let loaded = null; let ok = true;
      try {
        const { data, error } = await supabase.from("tax_settings")
          .select("*").eq("company_id", currentCompany.id).eq("tax_year", year).maybeSingle();
        if (error) { ok = false; console.warn("[tax_settings] load failed:", error.message); }
        if (!error && data) {
          rowExists.current = true;
          loaded = {
            estPaid: Number(data.estimated_payments_made) || 0,
            workFromHome: !!data.work_from_home,
            filed: (data.filed_deadlines && typeof data.filed_deadlines === "object" && !Array.isArray(data.filed_deadlines)) ? data.filed_deadlines : {},
          };
        }
      } catch (e) { ok = false; console.warn("[tax_settings] load error:", e?.message || e); }
      if (!cancelled) setLoadOk(ok);
      // the device-local mirror stands in only for a company with NO row yet — never for a read
      // that failed, where it could be stale against a figure the database holds
      if (!loaded && ok) {
        try { const ls = JSON.parse(localStorage.getItem(lsKey)); if (ls) loaded = { estPaid: Number(ls.estPaid) || 0, filed: ls.filed || {}, workFromHome: !!ls.workFromHome }; } catch {}
      }
      if (!cancelled && loaded) setTaxState(loaded);
    })();
    return () => { cancelled = true; };
  }, [currentCompany?.id, year]);

  const save = async (next) => {
    if (!loadOk) { showNotification && showNotification("We couldn't load your saved tax figures, so nothing can be changed here until the page reloads — nothing was saved.", "error"); return; }   // C417
    setTaxState(next);
    try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch {} // keep a local mirror as a backup
    try {
      const payload = {
        company_id: currentCompany.id, tax_year: year,
        estimated_payments_made: Number(next.estPaid) || 0,
        work_from_home: !!next.workFromHome,
        filed_deadlines: next.filed || {},
      };
      // ★★ THIS USED TO FAIL TO A `console.warn` AND NOTHING ELSE. What is being saved here
      // is the figures a person typed — estimated payments made, which deadlines are filed —
      // so a silent failure means they enter their tax position, see no complaint, and find
      // it gone next time they open the page. **A silent failure of the user's own typing is
      // the worst kind**: they have no reason to suspect it and no way to notice.
      const { data, error } = await supabase.from("tax_settings")
        .upsert(payload, { onConflict: "company_id,tax_year" })
        .select("company_id");
      if (error || !data || !data.length) {
        console.error("[tax_settings] save failed:", error?.message || "no rows written");
        showNotification && showNotification("Couldn't save your tax figures — they haven't been kept. Please try again.", "error");
        return;
      }
      rowExists.current = true;
      setFiledDeadlines && setFiledDeadlines(next.filed || {});   // C388 — Home and the bell read this map
    } catch (e) {
      console.error("[tax_settings] save failed:", e?.message || e);
      showNotification && showNotification("Couldn't save your tax figures — they haven't been kept. Please try again.", "error");
    }
  };
  const estPaid = Number(taxState.estPaid) || 0;
  const filed = taxState.filed || {};
  const workFromHome = !!taxState.workFromHome;

  const legalForm = companySettings?.legalForm || "";
  // ★ C678 — current IRS guidance (lib/taxGuidance.js): every spending account on its Schedule C
  // line, meals at 50%, entertainment 0%, the simplified home office, the current federal rules.
  // The home-office size is kept in the year's tax settings (filed_deadlines.home_office_sqft).
  // ★ C690 — the owner's filing status and other income, for the year's tax brackets.
  const profile = taxProfileFrom(filed, filedDeadlinesPrev || {});   // C693 — last year's answers carry forward
  const homeOfficeSqft = profile.homeOfficeSqft;
  const est = taxEstimate(invoices, year, estPaid, { chart: CHART_OF_ACCOUNTS || [], legalForm, assets: taxAssets || null, ...profile, priorProfile: taxProfileFrom(filedDeadlinesPrev || {}, filed), cutoffDate: cutoffDate || null });   // C683, C690, C695, C698
  const passThrough = legalForm !== "c_corp";
  const [otherDraft, setOtherDraft] = React.useState("");
  React.useEffect(() => { setOtherDraft(profile.otherIncome ? String(profile.otherIncome) : ""); }, [profile.otherIncome]);
  const [healthDraft, setHealthDraft] = React.useState("");   // C700
  React.useEffect(() => { setHealthDraft(profile.healthPremiums ? String(profile.healthPremiums) : ""); }, [profile.healthPremiums]);
  const [wagesDraft, setWagesDraft] = React.useState("");
  React.useEffect(() => { setWagesDraft(profile.ownWages ? String(profile.ownWages) : ""); }, [profile.ownWages]);
  const deadlines = getTaxDeadlines(new Date(), { legalForm: legalForm || null });   // O140/C559
  const deductions = deductionBreakdown(invoices, year, getAccountByRole, { chart: CHART_OF_ACCOUNTS || [], legalForm, assets: taxAssets || null, ...profile });   // C692 — miles and home office from the profile
  // ★ C692 — business miles, by the IRS standard mileage rate (lib/mileage.js)
  const [milesDraft, setMilesDraft] = React.useState("");
  const [milesAfterDraft, setMilesAfterDraft] = React.useState("");
  React.useEffect(() => { setMilesDraft(profile.businessMiles ? String(profile.businessMiles) : ""); }, [profile.businessMiles]);
  React.useEffect(() => { setMilesAfterDraft(profile.businessMilesAfterChange != null ? String(profile.businessMilesAfterChange) : ""); }, [profile.businessMilesAfterChange]);
  const mileageRates = mileageRatesFor(year);
  const carRow = deductions.find(d => d.line === "9");
  const mileageInfo = carRow && carRow.mileage;
  const [sqftDraft, setSqftDraft] = React.useState("");
  React.useEffect(() => { setSqftDraft(homeOfficeSqft ? String(homeOfficeSqft) : ""); }, [homeOfficeSqft]);
  const homeOfficeApplies = !legalForm || legalForm === "sole_prop";
  const totalDeductible = deductions.reduce((s, d) => s + (d.amount || 0), 0);
  // ── 1099s ARE WORKED OUT, NOT COUNTED OFF A FLAG ─────────────────────────────
  // This used to count `is1099` — a badge that was effectively defaulted on, so on one
  // company nearly every supplier carried it: food, equipment, a utility, none of them
  // reportable. A 1099 is filed with the IRS under the accountant's name, and that count is
  // what tells them how much work there is.
  //
  // ★ THE VENDOR'S PAYMENTS COME FROM THE LEDGER, matched on the same grouping key the
  // vendor list uses (O111), so a supplier known by two names is one supplier here too.
  // ★★★ C316 — BOTH SIDES OF THIS LOOKUP MUST BE NORMALISED THE SAME WAY, AND THEY WERE
  // NOT. The map was keyed on the row's `vendor_key` (O111's grouping key: legal suffixes,
  // trailing periods and "&" all normalised away) and read with the CONTACT's raw name
  // lower-cased. "Hill Country Milling Co." therefore looked up `hill country milling co.`
  // against rows filed under `hill country milling` and found NOTHING — so the vendor's
  // payments read as $0, fell under the $600 threshold, and were never reported.
  //
  // ★★ THE FAILURE DIRECTION IS THE DANGEROUS ONE: A MISSING 1099, SILENTLY. The plan says
  // "nothing to file" for a supplier who is owed one, and there is no screen on which that
  // absence looks like anything. C256's own note names this exact failure — "otherwise
  // their payments split and both halves fall under the threshold, which is a wrong answer
  // that looks tidy" — it got the ROW side right and the CONTACT side wrong.
  const keyOf = React.useCallback((s) => vendorGroupKey(s) || String(s || "").trim().toLowerCase(), []);
  // ★★ C549 — THE 1099 YEAR IS NOT THIS SCREEN'S YEAR. Everything else here (the estimate,
  // the deduction tracker, the header) is about the calendar year in progress; a 1099 is about
  // the payments of the year before its deadline. The two coincide for nine months and diverge
  // every January, when this card would count three weeks of the new year while the tracker it
  // links to correctly lists the year just ended. One question, one year — `taxYearFor1099`.
  const plan = React.useMemo(() => plan1099ForYear({ invoices, contacts, chart: CHART_OF_ACCOUNTS, year: year1099, keyOf, bankAccounts: bankAccounts || [] }),   // C435 — one builder with Home and the bell
    [invoices, contacts, CHART_OF_ACCOUNTS, year1099, keyOf, bankAccounts]);
  const need1099 = plan.outstanding;

  const card = { background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: "18px 20px" };

  // ★ C699 — the preparer's summary. Defaults to the year a preparer is working on: the one the
  // next 1099 deadline is about (last year from January to the filing season), else this year.
  // That year's own saved answers are read on click (this screen only loads this year's).
  const [packetYear, setPacketYear] = React.useState(year1099 < year ? year1099 : year);
  const [packetBusy, setPacketBusy] = React.useState(false);
  const downloadPacket = async () => {
    setPacketBusy(true);
    try {
      let rowFiled = packetYear === year ? filed : (filedDeadlinesPrev || {});
      let paidThatYear = packetYear === year ? estPaid : 0;
      if (packetYear !== year && currentCompany?.id) {
        try {
          const { data } = await supabase.from("tax_settings").select("filed_deadlines, estimated_payments_made")
            .eq("company_id", currentCompany.id).eq("tax_year", packetYear).maybeSingle();
          if (data) { rowFiled = data.filed_deadlines || rowFiled; paidThatYear = Number(data.estimated_payments_made) || 0; }
        } catch {}
      }
      const p = taxProfileFrom(rowFiled, packetYear === year ? (filedDeadlinesPrev || {}) : filed);
      const opts = { chart: CHART_OF_ACCOUNTS || [], legalForm, assets: taxAssets || null, ...p };
      const e = taxEstimate(invoices, packetYear, paidThatYear, opts);
      const d = deductionBreakdown(invoices, packetYear, getAccountByRole, opts);
      const f99 = tracker1099Rows({ invoices, contacts, chart: CHART_OF_ACCOUNTS, year: packetYear, bankAccounts: bankAccounts || [] });
      const rows = taxPacketRows({ year: packetYear, companyName: currentCompany?.name || "", legalForm, profile: p, est: e, deductions: d,
        assets: (taxAssets && taxAssets.assets) || [], estPaid: paidThatYear, form1099: f99, preparedOn: fmtDate(todayLocal()) });
      const ok = downloadCSV(taxPacketFilename(currentCompany?.name, packetYear), TAX_PACKET_HEADERS, rows);
      showNotification && showNotification(ok === false ? "The download didn't start — try again." : `Your ${packetYear} tax summary is downloading.`, ok === false ? "error" : "success");
    } finally { setPacketBusy(false); }
  };

  const toggleFiled = key => save({ ...taxState, filed: { ...filed, [key]: !filed[key] } });

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "var(--sc-text-2)", marginBottom: 8 }}>TAX COMPLIANCE</div>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Taxes</h1>
        <div style={{ fontSize: 13, color: "var(--sc-text-2)", marginTop: 6 }}>Your estimated tax picture, deadlines, and deductions — all from your books.</div>
      </div>

      {/* ── ★ C699 — ONE FILE FOR THE TAX PREPARER ── */}
      <div data-tax-packet style={{ ...card, marginBottom: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>For your tax preparer</div>
          <div style={{ fontSize: 12, color: "var(--sc-text-2)", marginTop: 3 }}>One spreadsheet with your income, spending by tax-form line, miles, home office, equipment, estimated payments and 1099s — the things a preparer asks for.</div>
        </div>
        <select value={packetYear} onChange={e => setPacketYear(Number(e.target.value))}
          style={{ background: "var(--sc-surface-2)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "var(--sc-text)" }}>
          {[year - 1, year].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <button onClick={downloadPacket} disabled={packetBusy}
          style={{ padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: "var(--sc-gold)", border: "none", color: "var(--sc-on-accent)", cursor: packetBusy ? "wait" : "pointer" }}>
          {packetBusy ? "Preparing…" : "Download"}
        </button>
      </div>

      {/* ── TAX PICTURE ── */}
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Your estimated tax picture · {year}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
          {[
            ["Profit so far this year", fmt(est.net), est.net >= 0 ? "var(--sc-text)" : "var(--sc-error)"],
            [legalForm === "c_corp" ? "Corporate income tax (21%)" : `Federal income tax (${year} brackets)`, fmt(est.federal), "var(--sc-text)"],   // C690
            // C685 — an S corporation's or C corporation's profit carries no self-employment tax; the owner's payroll covers it
            [legalForm === "s_corp" || legalForm === "c_corp" ? "Self-employment tax (none — your payroll covers it)" : "Self-Employment Tax (15.3%)", fmt(est.seTax), "var(--sc-text)"],
            ["Estimated tax for the year", fmt(est.total), "var(--sc-gold)"],
            ["Estimated Payments Made", fmt(estPaid), "var(--sc-success)"],
            ["Still Owed", fmt(est.owed), est.owed > 0 ? "var(--sc-warning)" : "var(--sc-success)"],
          ].map(([k, v, col]) => (
            <div key={k} style={{ background: "var(--sc-bg)", border: "1px solid var(--sc-surface-2)", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 11, color: "var(--sc-text-2)", marginBottom: 5 }}>{k}</div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: col }}>{v}</div>
            </div>
          ))}
        </div>
        {!loadOk && <div style={{ marginTop: 14 }}><LoadFailedNotice what="saved tax figures" table="tax_settings" /></div>}
        {passThrough && (
          <div data-tax-profile style={{ marginTop: 14, padding: "12px 14px", background: "var(--sc-bg)", border: "1px solid var(--sc-surface-2)", borderRadius: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>For a closer estimate</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, color: "var(--sc-text-2)" }}>How you file:</label>
              <select disabled={!loadOk} value={profile.assumed ? "" : profile.filingStatus}
                onChange={e => save({ ...taxState, filed: { ...filed, filing_status: e.target.value || null } })}
                style={{ background: "var(--sc-surface-2)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "var(--sc-text)" }}>
                <option value="">Choose…</option>
                {FILING_STATUSES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
              <label style={{ fontSize: 12, color: "var(--sc-text-2)" }}>Your pay from a job this year:</label>
              <input type="number" min="0" disabled={!loadOk} value={wagesDraft} placeholder="0" onChange={e => setWagesDraft(e.target.value)}
                onBlur={() => { const v = Math.max(0, Math.round(Number(wagesDraft) || 0)); if (v !== profile.ownWages || profile.carried) save({ ...taxState, filed: { ...filed, own_wages: v } }); }}
                style={{ width: 130, background: "var(--sc-surface-2)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "var(--sc-text)", outline: "none" }} />
              <label style={{ fontSize: 12, color: "var(--sc-text-2)" }}>Other household income (a spouse's pay, interest):</label>
              <input type="number" min="0" disabled={!loadOk} value={otherDraft} placeholder="0" onChange={e => setOtherDraft(e.target.value)}
                onBlur={() => { const v = Math.max(0, Math.round(Number(otherDraft) || 0)); if (v !== profile.otherIncome || profile.carried) save({ ...taxState, filed: { ...filed, other_income: v } }); }}
                style={{ width: 130, background: "var(--sc-surface-2)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "var(--sc-text)", outline: "none" }} />
            </div>
            <div style={{ fontSize: 11, color: "var(--sc-text-mut)", marginTop: 8 }}>
              {profile.assumed ? "Until you choose, we assume you file single with no other income. " : profile.carried ? "Carried over from last year — change anything that's different this year. " : ""}
              {est.total < 0 ? "Your business lost money, which lowers the tax on your other income. " : ""}
              The federal figure is the extra tax this business adds, after the {fmt(est.standardDeduction)} standard deduction and the 20% small-business deduction — a paycheck's withholding already covers the tax on a job.
              {est.qbiMayBeLimited ? " At this income the 20% small-business deduction can be limited — your tax preparer will check." : ""}
            </div>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <label style={{ fontSize: 12, color: "var(--sc-text-2)" }}>Estimated payments already made this year:</label>
          <input type="number" disabled={!loadOk} defaultValue={estPaid || ""} placeholder="0" onBlur={e => save({ ...taxState, estPaid: parseFloat(e.target.value) || 0 })}
            style={{ width: 140, background: "var(--sc-surface-2)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "var(--sc-text)", outline: "none" }} />
          <span style={{ fontSize: 11, color: "var(--sc-text-mut)" }}>Updates "Still Owed" above.</span>
        </div>
        {/* ★ C695 — what to pay each quarter, by the IRS safe harbor */}
        {est.total > 0 && (
          <div data-safe-harbor style={{ fontSize: 12, color: "var(--sc-text)", marginTop: 12 }}>
            {est.safeHarbor?.basis === "last_year" ? (<>
              <strong>Pay about {fmt(est.quarterly)} each quarter</strong>{" "}
              {`— ${est.safeHarbor.factor > 1 ? "110%" : "100%"} of last year's tax from the business (${fmt(est.safeHarbor.lastYearTax)}, from your books — if last year's tax return shows a different figure, use that). Paying this by each deadline avoids an underpayment penalty whatever this year turns out to be; anything more you owe is due in April.`}
            </>) : est.safeHarbor?.basis === "so_far" ? (<>
              <strong>Pay about {fmt(est.quarterly)} by the next deadline</strong>{" "}
              — the tax on this year's profit so far, less what you've already paid. Paying as you go like this keeps you close to what you'll owe; your tax preparer can tell you the exact amount that avoids a penalty.
            </>) : (<><strong>Pay about {fmt(est.quarterly)} each quarter</strong> — a quarter of this year's estimate.</>)}
          </div>
        )}
        <div style={{ fontSize: 11, color: "var(--sc-text-mut)", marginTop: 10 }}>This is an estimate. Consult your tax advisor for exact amounts.</div>
      </div>

      {/* ── DEADLINE TRACKER ── */}
      <div style={{ ...card, marginBottom: 16, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--sc-surface-2)", fontSize: 13, fontWeight: 600 }}>Upcoming tax deadlines</div>
        {/* ★★ O140/C559 — THE CALENDAR NEEDS TO KNOW HOW THE BUSINESS FILES. Until it does it shows
            every deadline (a partnership return to a sole owner, a personal return to a
            corporation), and says so rather than leaving the reader to wonder. The control sits
            beside the list it changes (O129). */}
        <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--sc-surface-2)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label htmlFor="tax-legal-form" style={{ fontSize: 12, color: "var(--sc-text-2)" }}>How does your business file taxes?</label>
          <select id="tax-legal-form" value={legalForm} onChange={e => saveLegalForm && saveLegalForm(e.target.value)}
            style={{ flex: "1 1 260px", padding: "7px 10px", borderRadius: 8, border: "1px solid var(--sc-border-2)", fontSize: 13, color: "var(--sc-text)", background: "var(--sc-surface)" }}>
            <option value="">I'm not sure</option>
            {LEGAL_FORMS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          {!legalForm && (
            <div style={{ fontSize: 12, color: "var(--sc-text-mut)", flexBasis: "100%" }}>
              Until you choose, we show every deadline — some of them won't apply to your business.
            </div>
          )}
        </div>
        {deadlines.map(d => {
          const isFiled = !!filed[filedKey(d)];
          return (
            <div key={`${d.key}-${d.year}`} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 20px", borderBottom: "1px solid var(--sc-surface-2)", opacity: isFiled ? 0.55 : 1 }}>
              <div style={{ width: 6, height: 38, borderRadius: 3, background: isFiled ? "var(--sc-text-mut)" : d.color, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, textDecoration: isFiled ? "line-through" : "none" }}>{d.plain}</div>
                <div style={{ fontSize: 12, color: "var(--sc-text-2)", marginTop: 2 }}>
                  {d.date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  {d.est && est.total > 0 && <span> · est. {fmt(est.quarterly)}</span>}
                  {" · "}<a href={d.url} target="_blank" rel="noreferrer" style={{ color: "var(--sc-gold)" }}>{d.form} ↗</a>
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: isFiled ? "var(--sc-text-mut)" : d.color }}>{isFiled ? "Done" : d.days === 0 ? "Due today" : `${d.days} days`}</div>
              </div>
              <button onClick={() => toggleFiled(`${d.key}-${d.year}`)} title="Mark as filed/paid"
                style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", background: isFiled ? "var(--sc-success-soft)" : "var(--sc-surface-2)", border: `1px solid ${isFiled ? "var(--sc-success-soft)" : "var(--sc-border-2)"}`, color: isFiled ? "var(--sc-success)" : "var(--sc-text-2)" }}>
                {isFiled ? "✓ Filed" : "Mark filed"}
              </button>
              {/* C579 — "Remind me" showed a toast and set nothing; a reminder that does not remind is
                  worse than none. Deadlines inside the window already come to Home's waiting list. */}
            </div>
          );
        })}
      </div>

      {/* ── DEDUCTION TRACKER ── */}
      <div style={{ ...card, marginBottom: 16, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--sc-surface-2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Deductions tracker · {year}</div>
          <div style={{ fontSize: 12, color: "var(--sc-text-2)" }}>Est. tax savings ≈ <span style={{ color: "var(--sc-success)", fontWeight: 600 }}>{fmt(totalDeductible * est.marginalRate)}</span></div>
        </div>
        {deductions.filter(d => !d.ask && d.line !== "none" && d.line !== "30").map(d => (
          <div key={d.key} data-deduction-line={d.line} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: "1px solid var(--sc-surface-2)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{d.label} <span style={{ fontSize: 11, color: "var(--sc-text-mut)", fontWeight: 400 }}>· {d.line === "4" ? "line 4" : `line ${d.line}`}</span></div>
              <div style={{ fontSize: 11, color: "var(--sc-text-mut)", marginTop: 2 }}>{d.hint}{d.notDeductible > 0.004 ? ` · ${fmt(d.notDeductible)} of this doesn't count (meals count at 50%)` : ""}{d.mileage ? " · your car by the IRS mileage rate, plus parking and tolls" : d.taxAdjusted ? " · for tax, equipment is mostly deducted in full in the year you start using it, not spread out like in your books" : ""}</div>
            </div>
            <div style={{ textAlign: "right", minWidth: 110 }}>
              <div style={{ fontSize: 15, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: "var(--sc-text)" }}>{fmt(d.amount)}</div>
              <div style={{ fontSize: 11, color: "var(--sc-success)" }}>~{fmt(d.amount * est.marginalRate)} saved</div>
            </div>
          </div>
        ))}
        {deductions.filter(d => d.line === "none").map(d => (
          <div key={d.key} data-deduction-line="none" style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: "1px solid var(--sc-surface-2)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Not deductible</div>
              <div style={{ fontSize: 11, color: "var(--sc-text-mut)", marginTop: 2 }}>{d.hint} — entertainment, fines and income tax don't reduce your tax</div>
            </div>
            <div style={{ textAlign: "right", minWidth: 110, fontSize: 13, fontFamily: "'DM Mono',monospace", color: "var(--sc-text-mut)" }}>{fmt(d.raw)}</div>
          </div>
        ))}
        {/* ★ C678 — the home office by the IRS simplified method: $5 a square foot, up to 300. */}
        {homeOfficeApplies && (
          <div data-home-office style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: "1px solid var(--sc-surface-2)", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Home office <span style={{ fontSize: 11, color: "var(--sc-text-mut)", fontWeight: 400 }}>· line 30</span></div>
              <div style={{ fontSize: 11, color: "var(--sc-text-mut)", marginTop: 2 }}>If part of your home is used only and regularly for work, enter its size. We use the IRS simplified method: $5 a square foot, up to 300 sq ft ($1,500).</div>
            </div>
            <input type="number" inputMode="numeric" min="0" max="300" placeholder="sq ft" value={sqftDraft} onChange={e => setSqftDraft(e.target.value)}
              onBlur={() => { const v = Math.max(0, Math.min(300, Math.floor(Number(sqftDraft) || 0))); if (v !== homeOfficeSqft) save({ ...taxState, filed: { ...filed, home_office_sqft: v } }); }}
              style={{ width: 90, background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "7px 10px", color: "var(--sc-text)", fontSize: 13 }} />
            <div style={{ textAlign: "right", minWidth: 110, fontSize: 15, fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>{fmt(homeOfficeSqft ? Math.min(300, homeOfficeSqft) * 5 : 0)}</div>
          </div>
        )}
        {/* ★ C692 — the car by the IRS standard mileage rate (sole proprietor, Schedule C line 9). */}
        {homeOfficeApplies && (
          <div data-mileage style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: "1px solid var(--sc-surface-2)", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Business miles <span style={{ fontSize: 11, color: "var(--sc-text-mut)", fontWeight: 400 }}>· line 9</span></div>
              <div style={{ fontSize: 11, color: "var(--sc-text-mut)", marginTop: 2 }}>
                Miles you drove for work this year (not your commute). We use the IRS rate — {mileageRates.map((r, i) => `${(r.rate * 100).toFixed(1).replace(/\.0$/, "")}¢ a mile${mileageRates.length > 1 ? (i === 0 ? " until " + fmtDate(mileageRates[1].from) : " from then") : ""}`).join(", ")} — which covers gas, repairs and insurance. Parking and tolls still count on top. Keep a simple log of your trips.
                {mileageInfo && mileageInfo.assumedSplit ? ` We've assumed your miles were spread evenly through the year; enter the miles from ${fmtDate(mileageRates[1].from)} for an exact figure.` : ""}
                {mileageInfo && mileageInfo.replaced > mileageInfo.amount ? ` The car costs you recorded (${fmt(mileageInfo.replaced)}) are more than the mileage rate gives — if you've never used the mileage rate for this car, deducting actual costs may save more; ask your tax preparer.` : ""}
              </div>
            </div>
            <input type="number" inputMode="numeric" min="0" placeholder="miles" value={milesDraft} onChange={e => setMilesDraft(e.target.value)}
              onBlur={() => { const v = Math.max(0, Math.floor(Number(milesDraft) || 0)); if (v !== profile.businessMiles) save({ ...taxState, filed: { ...filed, business_miles: v } }); }}
              style={{ width: 90, background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "7px 10px", color: "var(--sc-text)", fontSize: 13 }} />
            {mileageRates.length > 1 && (
              <input type="number" inputMode="numeric" min="0" placeholder={`since ${fmtDate(mileageRates[1].from)}`} value={milesAfterDraft} onChange={e => setMilesAfterDraft(e.target.value)}
                onBlur={() => { const raw = String(milesAfterDraft).trim(); const v = raw === "" ? null : Math.max(0, Math.floor(Number(raw) || 0)); if (v !== profile.businessMilesAfterChange) save({ ...taxState, filed: { ...filed, business_miles_after_change: v } }); }}
                style={{ width: 120, background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "7px 10px", color: "var(--sc-text)", fontSize: 13 }} />
            )}
            <div style={{ textAlign: "right", minWidth: 110, fontSize: 15, fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>{fmt(mileageInfo ? mileageInfo.amount : 0)}</div>
          </div>
        )}
        {deductions.filter(d => d.ask).map(d => (
          <div key={d.key} style={{ padding: "12px 20px", borderBottom: "1px solid var(--sc-surface-2)" }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{d.label}</div>
            <div style={{ fontSize: 11, color: "var(--sc-text-mut)", marginTop: 2 }}>{d.hint}</div>
            {/* ★ C696 — the room, worked out from this year's profit so far, and what it would save */}
            {/* ★ C700 — premiums the owner pays, counted in the estimate (sole proprietor / partner) */}
            {d.key === "health" && legalForm !== "s_corp" && legalForm !== "c_corp" && (
              <div data-health-premiums style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                <label style={{ fontSize: 12, color: "var(--sc-text-2)" }}>Health insurance you pay for yourself (and family) this year:</label>
                <input type="number" min="0" disabled={!loadOk} value={healthDraft} placeholder="0" onChange={e => setHealthDraft(e.target.value)}
                  onBlur={() => { const v = Math.max(0, Math.round(Number(healthDraft) || 0)); if (v !== profile.healthPremiums || profile.carried) save({ ...taxState, filed: { ...filed, health_premiums: v } }); }}
                  style={{ width: 120, background: "var(--sc-surface-2)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: "var(--sc-text)", outline: "none" }} />
                {est.healthDeduction > 0 && <span style={{ fontSize: 12, color: "var(--sc-success)" }}>{fmt(est.healthDeduction)} counted in your estimate</span>}
                <div style={{ fontSize: 11, color: "var(--sc-text-mut)", width: "100%" }}>It lowers your income tax (not self-employment tax), up to your business profit. It doesn't count for any month you could have joined a plan through a job — yours or a spouse's.</div>
              </div>
            )}
            {d.key === "retirement" && est.retirement && est.retirement.sep > 0 && (
              <div data-retirement-room style={{ fontSize: 12, color: "var(--sc-text)", marginTop: 6 }}>
                From your profit so far, you could put up to <strong>{fmt(est.retirement.sep)}</strong> into a SEP-IRA (saving about {fmt(est.retirement.sepSaves)} in tax this year){est.retirement.hasEmployees ? "" : <>, or up to <strong>{fmt(est.retirement.solo401k)}</strong> into a Solo 401(k) (saving about {fmt(est.retirement.solo401kSaves)}){est.retirement.catchUp50 > 0 ? ` — the Solo 401(k) allows ${fmt(est.retirement.catchUp50)} more if you're 50 or older${est.retirement.catchUp6063 > est.retirement.catchUp50 ? ` (${fmt(est.retirement.catchUp6063)} at 60–63)` : ""}` : ""}</>}.
                {est.retirement.hasEmployees ? " Because you have employees, a SEP must give them the same percentage, and a Solo 401(k) isn't available — ask your tax preparer which plan fits." : ""}
                {!est.retirement.hasEmployees && est.retirement.hasJob ? " If you also save in a 401(k) at your job, that counts against the Solo 401(k)'s employee limit." : ""}
                {" "}Both can be opened for this year until your tax return is due (a new Solo 401(k) by the return's original due date).
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── 1099 INTEGRATION ── */}
      <div style={{ ...card, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>1099 contractors</div>
          <div style={{ fontSize: 12, color: need1099 > 0 ? "var(--sc-warning)" : "var(--sc-text-2)", marginTop: 3 }}>
            {plan1099Copy(plan, { year: year1099 })}
          </div>
        </div>
        <button onClick={() => setView("tax1099")} style={{ padding: "9px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, background: "var(--sc-gold-soft)", border: "1px solid var(--sc-gold-soft)", color: "var(--sc-gold)", cursor: "pointer" }}>Open 1099 tracker →</button>
      </div>

      {/* ── DISCLAIMERS ── */}
      <div style={{ background: "var(--sc-warning-soft)", border: "1px solid var(--sc-warning-soft)", borderRadius: 14, padding: "16px 20px" }}>
        <div style={{ fontSize: 12, color: "var(--sc-warning)", lineHeight: 1.6 }}>
          Tax estimates are for planning purposes only and are based on general federal tax rates. State taxes, deductions and your specific situation can change what you actually owe by a lot. Always consult a qualified tax professional before filing.
        </div>
        {/* ★★★ C550 — THIS PROMISED A REVIEW NOBODY MAY BE DOING, AND NAMED A PRODUCT THAT DOES
            NOT EXIST. It read "Your CFAI advisor reviews your books monthly and can provide
            personalized guidance" — "CFAI" is the old working name, surviving in exactly one
            user-visible string (and in a localStorage key just above), and the sentence is FALSE
            for anyone who signed up alone: `O131`/`D2` record that a solo owner has no reviewer
            until they invite an accountant. Sitting directly under a tax disclaimer, on the
            screen about money owed to the IRS, it is the worst place in the product to overstate
            who is watching. `hasAttester` already answers this and DEFAULTS TRUE, so a failed
            membership read can never manufacture "you have no accountant" (O131's own rule). */}
        <div style={{ fontSize: 12, color: "var(--sc-gold)", lineHeight: 1.6, marginTop: 10, fontWeight: 500 }}>
          {hasAttester === false
            ? "Questions? Nobody is reviewing your books yet — add your accountant under Settings → Team and they can go through these with you."
            : "Questions? Your accountant can review your books and go through these figures with you."}
        </div>
      </div>
    </div>
  );
}
