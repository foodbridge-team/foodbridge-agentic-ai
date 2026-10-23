import fs from "fs";

const emojiTranslations = {
  "🚴 Delivery & Volunteer Fleet": "🚴 ವಿತರಣಾ ಮತ್ತು ಸ್ವಯಂಸೇವಕ ಪಡೆ",
  "🍲 Cooked Warm Meals": "🍲 ಬಿಸಿ ಬೇಯಿಸಿದ ಊಟ",
  "🍞 Bakery & Breads": "🍞 ಬೇಕರಿ ಮತ್ತು ಬ್ರೆಡ್",
  "📦 Packaged Groceries": "📦 ಪ್ಯಾಕ್ ಮಾಡಿದ ದಿನಸಿ",
  "🍎 Fresh Produce / Fruits": "🍎 ತಾಜಾ ಉತ್ಪನ್ನಗಳು / ಹಣ್ಣುಗಳು",
  "🌱 Good Food Deserves a Second Chance.": "🌱 ಉತ್ತಮ ಆಹಾರಕ್ಕೆ ಮತ್ತೊಂದು ಅವಕಾಶ.",
  "⚡ Safe &amp; Cryptographically Verified": "⚡ ಸುರಕ್ಷಿತ ಮತ್ತು ಕ್ರಿಪ್ಟೋಗ್ರಾಫಿಕವಾಗಿ ಪರಿಶೀಲಿಸಲಾಗಿದೆ",
  "⚡ Safe & Cryptographically Verified": "⚡ ಸುರಕ್ಷಿತ ಮತ್ತು ಕ್ರಿಪ್ಟೋಗ್ರಾಫಿಕವಾಗಿ ಪರಿಶೀಲಿಸಲಾಗಿದೆ",
  "⏱️ Safe Expiry Window": "⏱️ ಸುರಕ್ಷಿತ ಬಳಕೆಯ ಅವಧಿ",
  "🎯 Feasibility Checked": "🎯 ಕಾರ್ಯಸಾಧ್ಯತೆ ಪರಿಶೀಲಿಸಲಾಗಿದೆ",
  "🔒 HMAC-SHA256 Protected": "🔒 HMAC-SHA256 ರಕ್ಷಿತ",
  "📜 100% Audit Verified": "📜 100% ಆಡಿಟ್ ದೃಢೀಕರಿಸಲಾಗಿದೆ",
  "🏢 NGO & Shelter Hub": "🏢 ಎನ್‌ಜಿಒ ಮತ್ತು ಆಶ್ರಯ ಕೇಂದ್ರ"
};

let content = fs.readFileSync("public/i18n.js", "utf8");
const marker = '    "FoodBridge AI": "FoodBridge AI"';
if (content.includes(marker)) {
  const linesToAdd = Object.entries(emojiTranslations).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n");
  content = content.replace(marker, marker + ",\n" + linesToAdd);
  fs.writeFileSync("public/i18n.js", content, "utf8");
  console.log("public/i18n.js updated with emoji strings!");
} else {
  console.error("Marker not found in public/i18n.js");
}
