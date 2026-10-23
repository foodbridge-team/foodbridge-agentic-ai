import fs from "fs";

// Load i18n
const i18nContent = fs.readFileSync("public/i18n.js", "utf8");
// Extract translations object
const fn = new Function(i18nContent + "; return window.foodBridgeTranslate;");
// Mock window
global.window = {};
global.localStorage = {
  getItem: (k) => "kn",
  setItem: () => {}
};
global.document = {
  documentElement: { setAttribute: () => {}, lang: "en" },
  addEventListener: () => {},
  querySelectorAll: () => []
};

// Check translation of common phrases
const testPhrases = [
  "Home",
  "Food Donor",
  "NGO Shelter",
  "Delivery Fleet",
  "Admin",
  "Light Mode",
  "Dark Mode",
  "How FoodBridge AI Works",
  "Good Food Deserves a Second Chance.",
  "Make surplus food a community lifeline",
  "Food Donor Portal",
  "NGO & Shelter Hub",
  "Delivery Dispatch Hub",
  "Verified partner assignments",
  "Two-stage OTP verification protocol",
  "Photo evidence for completion",
  "Zero food waste",
  "OTP-secured handovers",
  "100% Tamper-proof ledger",
  "Role Portals",
  "Platform Links",
  "Register New NGO",
  "List Surplus Food",
  "Volunteer Dispatch",
  "Available",
  "Reserved",
  "Assigned",
  "Picked Up",
  "Delivered"
];

// Execute i18n
new Function(i18nContent)();

let untranslated = 0;
for (const phrase of testPhrases) {
  const result = window.foodBridgeTranslate(phrase);
  if (result === phrase) {
    console.log("FAIL (untranslated):", phrase);
    untranslated++;
  } else {
    console.log("OK:", phrase, "->", result);
  }
}

if (untranslated === 0) {
  console.log("\nAll test phrases translated cleanly to Kannada!");
} else {
  console.error("\nThere were untranslated phrases!");
  process.exit(1);
}
