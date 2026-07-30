/**
 * data/salary-tables.json と data/vintages.json の構造・整合性をチェックする。
 * 俸給表データを更新したときに、形式崩れや号俸の並び順の誤りを早期に検出するのが目的。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL - ${name}\n    ${e.message}`);
  }
}

const catalog = JSON.parse(readFileSync(path.join(root, "data/salary-tables.json"), "utf8"));

test("salary-tables.json: order と tables のキーが一致する", () => {
  const tableKeys = new Set(Object.keys(catalog.tables));
  for (const key of catalog.order) {
    assert.ok(tableKeys.has(key), `order に含まれる "${key}" が tables に存在しない`);
  }
});

test("salary-tables.json: 各俸給表がlabel/typeを持ち、号俸配列が単調増加である", () => {
  let seriesChecked = 0;
  for (const [key, table] of Object.entries(catalog.tables)) {
    assert.ok(table.label, `${key}: label が必要`);
    assert.ok(["graded", "flat"].includes(table.type), `${key}: type は graded/flat のいずれか`);

    const seriesList =
      table.type === "graded"
        ? Object.entries(table.grades || {}).map(([grade, amounts]) => [`${key} ${grade}級`, amounts])
        : [[key, table.steps]];

    for (const [label, amounts] of seriesList) {
      assert.ok(Array.isArray(amounts) && amounts.length > 0, `${label}: 号俸配列が空`);
      for (const amount of amounts) {
        assert.ok(Number.isFinite(amount) && amount > 0, `${label}: 不正な金額 ${amount}`);
      }
      for (let i = 1; i < amounts.length; i++) {
        assert.ok(amounts[i] >= amounts[i - 1], `${label}: 号俸${i + 1}が号俸${i}より小さい（単調増加でない）`);
      }
      seriesChecked++;
    }
  }
  console.log(`  (${seriesChecked} 件の級・俸給表の号俸系列を確認)`);
});

const vintages = JSON.parse(readFileSync(path.join(root, "data/vintages.json"), "utf8"));

test("vintages.json: 構造が正しい", () => {
  assert.ok(Array.isArray(vintages.vintages) && vintages.vintages.length > 0, "vintages 配列が必要");
  for (const v of vintages.vintages) {
    assert.ok(v.key && v.label, "各バージョンに key と label が必要");
    if (v.available) {
      assert.ok(v.file, `${v.key}: available:true のバージョンは file が必要`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
