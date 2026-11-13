// C702 — Home says when a customer is late paying you, with the reminder one tap away.
import { describe, it, expect } from "vitest";
import { lateCustomersItem, homeWaitingList } from "../src/lib/homeWaiting.js";
import { readFileSync } from "node:fs";

describe("C702 — the item", () => {
  it("one late invoice: who, how late, how much, and the reminder email", () => {
    const it1 = lateCustomersItem([{ customer: "Acme Co", amount: 1250, daysLate: 12, mailto: "mailto:pay@acme.test?subject=x" }]);
    expect(it1.text).toBe("Acme Co is 12 days late paying you $1,250.00.");
    expect(it1.link).toEqual({ label: "Send a reminder", url: "mailto:pay@acme.test?subject=x" });
    expect(it1.actions[0]).toMatchObject({ kind: "nav", view: "ar" });
  });
  it("several: the number of customers and the total", () => {
    const it2 = lateCustomersItem([{ customer: "Acme", amount: 1000, daysLate: 3 }, { customer: "Beta", amount: 500, daysLate: 40 }, { customer: "acme", amount: 200, daysLate: 9 }]);
    expect(it2.text).toBe("2 customers are late paying you — $1,700.00 in total.");
    expect(it2.actions[0]).toMatchObject({ label: "Send reminders", view: "ar" });
  });
  it("two invoices from one customer name them, not 'customers'", () => {
    expect(lateCustomersItem([{ customer: "Acme", amount: 1000, daysLate: 3 }, { customer: "Acme", amount: 500, daysLate: 40 }]).text).toBe("Acme is late paying you — $1,500.00 in total.");
  });
  it("nothing late → nothing", () => {
    expect(lateCustomersItem([])).toBe(null);
    expect(lateCustomersItem([{ customer: "x", amount: 0, daysLate: 5 }])).toBe(null);
    expect(lateCustomersItem([{ customer: "x", amount: 300, daysLate: 0 }])).toBe(null);   // due today isn't late
  });
  it("it's on the waiting list", () => {
    const items = homeWaitingList({ lateInvoices: [{ customer: "Acme", amount: 900, daysLate: 2 }] });
    expect(items.map((i) => i.id)).toContain("late_customers");
  });
});

describe("C702 — Home computes it from the books", () => {
  const src = readFileSync("src/components/views/DashboardView.jsx", "utf8");
  it("open receivables past their due date, each with the reminder email", () => {
    expect(src).toMatch(/const lateInvoices = openReceivablesGL\(invoices \|\| \[\], getAccountByRole\?\.\("accounts_receivable"\)\?\.code\)/);
    expect(src).toMatch(/mailto: reminderMailto\(\{ email: customerEmail\(contacts \|\| \[\], i\.vendor\)/);
    expect(src).toMatch(/dueSoonBills, lateInvoices,/);
  });
  it("the door opens the late list", () => {
    expect(src).toMatch(/ar: \(\) => go\("ar", \(\) => setArView && setArView\("collections"\)\)/);
  });
});
