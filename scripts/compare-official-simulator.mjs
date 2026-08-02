/**
 * 人事院の給与シミュレーター（.xlsm）とWeb版を大量照合するためのランナー。
 *
 * 実行例:
 *   node scripts/compare-official-simulator.mjs \
 *     /Users/ym/Downloads/人事院_給与シミュレーター.xlsm \
 *     tests/official-simulator-scenarios.json \
 *     /tmp/official-simulator-report.json
 *
 * Microsoft Excel for Mac が必要です。公式ブックは読み取り専用で開き、保存しません。
 * Excel側のマクロが有効であることを確認してから実行してください。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const [, , officialBookPath, scenariosPath, reportPath = "official-simulator-report.json"] = process.argv;
if (!officialBookPath || !scenariosPath) {
  throw new Error("Usage: node scripts/compare-official-simulator.mjs <official.xlsm> <scenarios.json> [report.json]");
}
if (process.platform !== "darwin") {
  throw new Error("公式Excelとの照合は、Microsoft Excel for Macを操作するためmacOS上で実行してください。");
}

const root = path.resolve(import.meta.dirname, "..");
const scenarios = JSON.parse(readFileSync(scenariosPath, "utf8"));
assert.ok(Array.isArray(scenarios) && scenarios.length > 0, "シナリオJSONは1件以上の配列にしてください。");

/** Excelの「計算ツール」シートで直接設定する入力セル。 */
const EXCEL_INPUT_COLUMNS = [
  "id",
  "payTable",
  "grade",
  "step",
  "specialAdjustmentCategory",
  "officeLocation",
  "singleAssignmentDistance",
  "rent",
  "spouseRent",
  "commuterPassSixMonths",
  "childCount",
  "childAge1",
  "childAge2",
  "childAge3",
  "childAge4",
  "otherDependentCount",
  "weekdayOvertimeHours",
  "meritJune",
  "meritDecember",
];

const OFFICIAL_OUTPUT_COLUMNS = [
  "baseSalary",
  "specialAdjustmentAllowance",
  "regionalAllowance",
  "honshoAllowance",
  "singleAssignmentAllowance",
  "housingAllowance",
  "dependentAllowance",
  "overtimeAllowance",
  "monthlyTotal",
  "commutingAnnual",
  "bonusAnnualMin",
  "bonusAnnualMax",
  "annualIncomeMin",
  "annualIncomeMax",
];

function tsvValue(value) {
  if (value == null || value === "") return "";
  const text = String(value);
  if (/[\t\r\n]/.test(text)) throw new Error(`TSVではタブ・改行を含む値は使えません: ${text}`);
  return text;
}

function createExcelInputTsv(items) {
  const rows = [EXCEL_INPUT_COLUMNS.join("\t")];
  for (const scenario of items) {
    const input = scenario.official;
    if (!scenario.id || !input) throw new Error("各シナリオには id と official が必要です。");
    rows.push(EXCEL_INPUT_COLUMNS.map((key) => tsvValue(key === "id" ? scenario.id : input[key])).join("\t"));
  }
  return `${rows.join("\n")}\n`;
}

function parseNumber(value) {
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function parseOfficialOutputTsv(text) {
  const [header, ...rows] = text.trim().split(/\r?\n/);
  assert.equal(header, ["id", ...OFFICIAL_OUTPUT_COLUMNS].join("\t"), "公式Excelの出力列が不正です。");
  return new Map(
    rows.filter(Boolean).map((row) => {
      const values = row.split("\t");
      return [
        values[0],
        Object.fromEntries(OFFICIAL_OUTPUT_COLUMNS.map((key, index) => [key, parseNumber(values[index + 1])])),
      ];
    })
  );
}

function loadWebCalculator() {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(readFileSync(path.join(root, "js/data.js"), "utf8"), context, { filename: "js/data.js" });
  vm.runInContext(readFileSync(path.join(root, "js/calculator.js"), "utf8"), context, { filename: "js/calculator.js" });
  const catalog = JSON.parse(readFileSync(path.join(root, "data/salary-tables.json"), "utf8"));
  vm.runInContext(`SALARY_CATALOG = ${JSON.stringify(catalog)};`, context);
  context.teishuMonths = vm.runInContext("TEISHU_MONTHS", context);
  return context;
}

function calculateWeb(context, input) {
  const specialAdjustmentAllowance = input.specialAdjustmentCategory
    ? context.getSpecialAdjustmentAmount(input.tableKey, input.grade, input.specialAdjustmentCategory)
    : 0;
  const honshoAllowance = input.honshoEligible
    ? context.getHonshoAllowanceAmountForTable(input.tableKey, input.grade)
    : 0;
  return context.calculateSalary({
    tableKey: input.tableKey,
    grade: input.grade,
    step: input.step,
    regionalRate: input.regionalRate,
    childUnder15Count: input.childUnder15Count ?? 0,
    child16to22Count: input.child16to22Count ?? 0,
    parentCount: input.parentCount ?? 0,
    housingAllowance: input.housingEligible ? context.calcHousingAllowance(input.rent) : 0,
    honshoAllowance,
    specialAdjustmentAllowance,
    teishuMonths: input.teishuMonths ?? context.teishuMonths,
    meritRateJune: input.meritRateJune,
    meritRateDecember: input.meritRateDecember,
    weekdayNormalHours: input.weekdayNormalHours ?? 0,
    weekdayNightHours: input.weekdayNightHours ?? 0,
    holidayNormalHours: input.holidayNormalHours ?? 0,
    holidayNightHours: input.holidayNightHours ?? 0,
  });
}

/**
 * 公式ツールと同じ概念に対応する項目だけを比較する。
 * 賞与・年収は、公式ツールが最小〜最大で返すためWeb版の値がその範囲内かを比較する。
 */
function compareScenario(scenario, official, web) {
  const comparisons = [
    ["baseSalary", web.baseSalary, official.baseSalary],
    ["specialAdjustmentAllowance", web.specialAdjustmentAllowance, official.specialAdjustmentAllowance],
    ["regionalAllowance", web.regionalAllowance, official.regionalAllowance],
    ["honshoAllowance", web.honshoAllowance, official.honshoAllowance],
    ["housingAllowance", web.housingAllowance, official.housingAllowance],
    ["dependentAllowance", web.dependentAllowance, official.dependentAllowance],
    ["overtimeAllowance", web.overtimeAllowance, official.overtimeAllowance],
    ["monthlyTotal", web.monthlyTotal, official.monthlyTotal],
  ].map(([field, webValue, officialValue]) => ({
    field,
    web: webValue,
    official: officialValue,
    delta: officialValue == null ? null : webValue - officialValue,
    match: officialValue != null && webValue === officialValue,
  }));

  const rangeComparisons = [
    ["bonusAnnual", web.bonusAnnual, official.bonusAnnualMin, official.bonusAnnualMax],
    ["annualIncome", web.annualIncome, official.annualIncomeMin, official.annualIncomeMax],
  ].map(([field, webValue, min, max]) => ({
    field,
    web: webValue,
    officialMin: min,
    officialMax: max,
    match: min != null && max != null && min <= webValue && webValue <= max,
  }));

  return {
    id: scenario.id,
    ignoredOfficialOnlyItems: {
      singleAssignmentAllowance: official.singleAssignmentAllowance,
      commutingAnnual: official.commutingAnnual,
    },
    comparisons,
    rangeComparisons,
    passed: comparisons.every((item) => item.match) && rangeComparisons.every((item) => item.match),
  };
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), "official-simulator-"));
try {
  const inputTsv = path.join(tempDir, "input.tsv");
  const outputTsv = path.join(tempDir, "output.tsv");
  writeFileSync(inputTsv, createExcelInputTsv(scenarios), "utf8");
  execFileSync("osascript", [path.join(root, "scripts/official-simulator-bridge.applescript"), officialBookPath, inputTsv, outputTsv], {
    stdio: "inherit",
  });

  const officialResults = parseOfficialOutputTsv(readFileSync(outputTsv, "utf8"));
  const calculator = loadWebCalculator();
  const results = scenarios.map((scenario) => {
    const official = officialResults.get(scenario.id);
    if (!official) throw new Error(`公式Excelの結果がありません: ${scenario.id}`);
    if (!scenario.web) throw new Error(`Web版の入力がありません: ${scenario.id}`);
    return compareScenario(scenario, official, calculateWeb(calculator, scenario.web));
  });
  const report = {
    generatedAt: new Date().toISOString(),
    officialBookPath,
    total: results.length,
    passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length,
    results,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`照合完了: ${report.passed}/${report.total} 件一致。レポート: ${reportPath}`);
  if (report.failed > 0) process.exitCode = 1;
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
