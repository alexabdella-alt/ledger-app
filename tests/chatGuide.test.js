import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { resolveChatView } from "../src/lib/chatNav.js";
import { NAV_SECTIONS, NAV_SECTION_SETTINGS, visibleNav } from "../src/lib/nav.js";
import { PROFILES } from "../supabase/functions/ai-proxy/aiProfiles.js";

const sidebar = NAV_SECTIONS.flatMap((s) => s.items);
const settings = NAV_SECTION_SETTINGS.items;
const prompt = PROFILES["chat-brain"].system;

describe("C572 — the chat opens the right screen", () => {
  it("every sidebar and Settings row is reachable by its id and by the words on it", () => {
    for (const [id, label] of [...sidebar, ...settings]) {
      expect(resolveChatView(id).target, id).toBe(id);
      expect(resolveChatView(label).target, label).toBe(id);
    }
  });
  it("bills go to Bills to pay, money owed goes to Money owed to you — not the Transactions list", () => {
    for (const w of ["bills", "unpaid bills", "payables", "ap"]) expect(resolveChatView(w).target, w).toBe("ap");
    for (const w of ["receivables", "money owed to you", "who owes me", "ar"]) expect(resolveChatView(w).target, w).toBe("ar");
    expect(resolveChatView("books", "unpaid")).toEqual({ target: "ap", booksFilter: null });
    expect(resolveChatView("books", "receivables")).toEqual({ target: "ar", booksFilter: null });
  });
  it("Transactions keeps its filters, and contracts open Transactions filtered to contracts", () => {
    expect(resolveChatView("books", "revenue")).toEqual({ target: "books", booksFilter: "revenue" });
    expect(resolveChatView("transactions")).toEqual({ target: "books", booksFilter: "all" });
    expect(resolveChatView("expenses")).toEqual({ target: "books", booksFilter: "expenses" });
    expect(resolveChatView("contracts")).toEqual({ target: "books", booksFilter: "contracts" });
  });
  it("the screens owners ask for by name now resolve", () => {
    expect(resolveChatView("invite my accountant").target).toBe("team");
    expect(resolveChatView("categories").target).toBe("coa");
    expect(resolveChatView("quickbooks").target).toBe("onboard");
    expect(resolveChatView("teach us your vendors").target).toBe("rules");
    expect(resolveChatView("send an invoice").target).toBe("send-invoice");
    expect(resolveChatView("tax deadlines").target).toBe("tax");
  });
  it("a word that names no screen is passed through, so the seat guard says it couldn't find it", () => {
    expect(resolveChatView("spaceship").target).toBe("spaceship");
  });
  it("every screen the chat can name for an owner is one an owner may open, or is one the guide says belongs to the accountant", () => {
    const owner = visibleNav({ role: "owner", inSettings: true }).viewIds;
    for (const [id] of [...sidebar, ...settings]) expect(owner, id).toContain(id);
    expect(owner).toContain("send-invoice");
  });
  it("App.jsx resolves through chatNav, not a hand-kept alias list", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/resolveChatView\(action\.view, action\.filter\)/);
    expect(app).not.toMatch(/const viewAliases = \{/);
  });
});

describe("C572 — the chat's guide to the app describes the app that exists", () => {
  it("names every sidebar row and every Settings row, with its view id", () => {
    for (const [id, label] of [...sidebar, ...settings]) {
      expect(prompt, label).toContain(`${label} [${id}]`);
    }
  });
  it("no longer describes tabs that do not exist", () => {
    expect(prompt).not.toMatch(/3 tabs|5 tabs|Settings → 1099s/);
  });
  it("every button it tells the owner to press exists on screen, with exactly that wording", () => {
    const quoted = [...prompt.slice(prompt.indexOf("HOW TO USE THE APP —"), prompt.indexOf("CFO Intelligence Guidelines:"))
      .matchAll(/"([^"\n]+)"/g)].map((m) => m[1])
      // Owners' questions and the filter values are quoted too; only button/box names are checked.
      .filter((q) => !/\?$/.test(q) && !/^(all|revenue|expenses|review|contracts|filter|always file.*|Match my bank statement|reconcile|Something is in the wrong category)$/i.test(q));
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.(jsx?|tsx?)$/.test(e.name) ? [path.join(d, e.name)] : []);
    const ui = walk("src/components").map((f) => readFileSync(f, "utf8")).join("\n");
    expect(quoted.length).toBeGreaterThan(6);
    for (const q of quoted) expect(ui, `"${q}" is named in the chat's guide but no screen shows it`).toContain(q);
  });
});
