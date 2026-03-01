const path = require("path");
const xlsx = require("xlsx");

const filePath = path.join(__dirname, "..", "Data.xlsx");
const workbook = xlsx.readFile(filePath);
console.log("Sheets:", workbook.SheetNames);

for (const name of workbook.SheetNames) {
  const sheet = workbook.Sheets[name];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  console.log("\nSheet:", name);
  console.log("Rows:", rows.length);
  console.log("Header:", rows[0]);
  console.log("Sample:", rows.slice(1, 6));
}
