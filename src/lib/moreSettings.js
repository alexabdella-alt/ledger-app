// ═════════════════════════════════════════════════════════════════════════════
// C638 — "MORE SETTINGS": THE SETUP PAGES AN OWNER RARELY NEEDS, EACH WITH ONE LINE ON WHAT IT IS
// FOR. The owner's Settings menu is four rows (Your business · Team · Taxes · More settings);
// these are the rest, in the order an owner is likely to want them. Pure, so the words are tested.
// ═════════════════════════════════════════════════════════════════════════════
export const MORE_SETTINGS_INTRO = "Setup you'll only need now and then. Not sure which one? Ask the assistant.";

export const MORE_SETTINGS_PAGES = [
  { view: "opening-balances", title: "Starting balances", what: "What the business had and owed on the day you started using the app." },
  { view: "recurring", title: "Recurring charges", what: "Rent, subscriptions and other costs that repeat — so they're never missed." },
  { view: "rules", title: "Vendor rules", what: "\"Always file this vendor under this category.\" Or learn them all from a few old bank statements." },
  { view: "coa", title: "Categories", what: "The list of categories your money is filed into." },
  { view: "tax1099", title: "Tax forms (1099s)", what: "Which contractors need a 1099, and the file to send them." },
  { view: "onboard", title: "Import from QuickBooks", what: "Bring your books over from QuickBooks." },
  { view: "audit", title: "Audit trail", what: "A permanent record of every change made to your books." },
];
