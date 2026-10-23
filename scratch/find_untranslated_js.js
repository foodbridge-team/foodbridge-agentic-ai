import fs from "fs";

const i18n = fs.readFileSync("public/i18n.js", "utf8");
const transMatches = [...i18n.matchAll(/"([^"]+)":/g)].map(m => m[1]);
const transKeys = new Set(transMatches);

const jsFiles = ["app.js", "donor.js", "ngo.js", "delivery.js", "admin.js", "login.js", "ngo-signup.js", "footer.js", "api.js"];
const jsUnhandled = [];
for (const file of jsFiles) {
  const content = fs.readFileSync("public/" + file, "utf8");
  // Find string literals inside quotes
  const matches = [...content.matchAll(/["'`]([A-Z][a-zA-Z0-9\s.,!?:;/()—–'’"-]{3,80})["'`]/g)].map(m => m[1].trim());
  for (const t of matches) {
    if (!transKeys.has(t) && !jsUnhandled.includes(t) && !t.includes("http") && !t.includes("/") && !t.includes("<") && !t.startsWith("USER-") && !t.startsWith("FOODBRIDGE") && !t.startsWith("NGO-") && !t.startsWith("DONOR-")) {
      jsUnhandled.push(t);
    }
  }
}
console.log("Total potential JS strings:", jsUnhandled.length);
console.log(JSON.stringify(jsUnhandled, null, 2));
