/**
 * 俸給表データ各ファイル（data/salary-tables-*.json）と data/vintages.json の
 * 構造・整合性をチェックする。俸給表データを更新したときに、形式崩れや号俸の
 * 並び順の誤りを早期に検出するのが目的。
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

const vintages = JSON.parse(readFileSync(path.join(root, "data/vintages.json"), "utf8"));

test("vintages.json: 構造が正しい", () => {
  assert.ok(Array.isArray(vintages.vintages) && vintages.vintages.length > 0, "vintages 配列が必要");
  for (const v of vintages.vintages) {
    assert.ok(v.key && v.label, "各バージョンに key と label が必要");
    if (v.available) {
      assert.ok(v.file, `${v.key}: available:true のバージョンは file が必要`);
      assert.ok(v.allowanceFile, `${v.key}: available:true のバージョンは allowanceFile が必要`);
    }
  }
});

const currentVintage = vintages.vintages.find((v) => v.key === "current");
assert.ok(currentVintage && currentVintage.file, "vintages.json に file を持つ current バージョンが必要");
const catalog = JSON.parse(readFileSync(path.join(root, "data", currentVintage.file), "utf8"));

function validateSalaryTableFile(fileLabel, catalog) {
  test(`${fileLabel}: order と tables のキーが一致する`, () => {
    const tableKeys = new Set(Object.keys(catalog.tables));
    for (const key of catalog.order) {
      assert.ok(tableKeys.has(key), `order に含まれる "${key}" が tables に存在しない`);
    }
  });

  test(`${fileLabel}: 各俸給表がlabel/typeを持ち、号俸配列が単調増加である`, () => {
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
}

validateSalaryTableFile(currentVintage.file, catalog);

for (const v of vintages.vintages) {
  if (!v.available || !v.file || v.file === currentVintage.file) continue;
  const vintageCatalog = JSON.parse(readFileSync(path.join(root, "data", v.file), "utf8"));
  validateSalaryTableFile(v.file, vintageCatalog);

  test(`${v.file}: ${currentVintage.file} と同じ俸給表キー構成を持つ（19表が揃っている）`, () => {
    assert.deepEqual(
      new Set(Object.keys(vintageCatalog.tables)),
      new Set(Object.keys(catalog.tables)),
      `${v.file} の tables キーが ${currentVintage.file} と異なる`
    );
  });
}

function validateAllowanceRatesFile(fileLabel, allowanceRates) {
  test(`${fileLabel}: 期末手当の支給月数が正しい`, () => {
    const terminal = allowanceRates.terminalAllowance;
    assert.ok(allowanceRates.source, "出典が必要");
    assert.ok(Number.isInteger(allowanceRates.fiscalYear), "年度が必要");
    assert.equal("annualMonths" in terminal, false, "年間支給月数は保持しない");
    for (const staffType of ["general", "senior_manager", "designated"]) {
      assert.ok(terminal[staffType], `${staffType} の定義が必要`);
      for (const period of ["june", "december"]) {
        assert.ok(
          Number.isFinite(terminal[staffType][period]) && terminal[staffType][period] >= 0,
          `${staffType}.${period} は0以上の数値である必要がある`
        );
      }
    }
  });

  test(`${fileLabel}: 期末手当の役職段階別加算割合が正しい`, () => {
    const rates = allowanceRates.bonusRoleStageAdditionRates;
    assert.equal(rates.designated, 0.2);
    assert.deepEqual(rates.administrative_1, {
      3: 0.05, 4: 0.1, 5: 0.1, 6: 0.15, 7: 0.15, 8: 0.2, 9: 0.2, 10: 0.2,
    });
  });
}

for (const v of vintages.vintages) {
  if (!v.available || !v.allowanceFile) continue;
  const allowanceRates = JSON.parse(readFileSync(path.join(root, "data", v.allowanceFile), "utf8"));
  validateAllowanceRatesFile(v.allowanceFile, allowanceRates);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
