/**
 * js/data.js と js/calculator.js の計算ロジックに対するユニットテスト。
 * ブラウザ専用のグローバルスクリプトを Node の vm でそのまま実行し、
 * 本番コードに一切手を加えずにテストする。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const context = { console };
vm.createContext(context);
vm.runInContext(readFileSync(path.join(root, "js/data.js"), "utf8"), context, { filename: "js/data.js" });
vm.runInContext(readFileSync(path.join(root, "js/calculator.js"), "utf8"), context, { filename: "js/calculator.js" });

// テスト用の小さな俸給表カタログに差し替え、実データに依存しない決定的なテストにする。
// SALARY_CATALOG は data.js 内で `let` 宣言されているため、context のプロパティに
// 直接代入しても書き換わらない（let/const はグローバルオブジェクトのプロパティにならない）。
// そのためコンテキスト内でコードとして代入式を実行する。
const fixtureCatalog = {
  order: ["test_graded", "test_flat"],
  tables: {
    test_graded: {
      label: "テスト用俸給表",
      type: "graded",
      grades: {
        1: [100000, 101000, 102000, 103000],
        2: [150000, 151000],
      },
    },
    test_flat: {
      label: "テスト用フラット俸給表",
      type: "flat",
      steps: [500000, 510000, 520000],
    },
  },
};
vm.runInContext(`SALARY_CATALOG = ${JSON.stringify(fixtureCatalog)};`, context);

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

// --- getSalaryAmount / getMaxStep -------------------------------------------------

test("getSalaryAmount: 通常のインデックス", () => {
  assert.equal(context.getSalaryAmount("test_graded", 1, 2), 101000);
});

test("getSalaryAmount: 号俸が上限を超えたら最大値にクリップ", () => {
  assert.equal(context.getSalaryAmount("test_graded", 1, 999), 103000);
});

test("getSalaryAmount: flat型俸給表は級を無視してstepsを参照", () => {
  assert.equal(context.getSalaryAmount("test_flat", null, 2), 510000);
});

test("getMaxStep: 級ごとの号俸数を返す", () => {
  assert.equal(context.getMaxStep("test_graded", 1), 4);
  assert.equal(context.getMaxStep("test_graded", 2), 2);
});

// --- calcHousingAllowance ----------------------------------------------------------

test("calcHousingAllowance: 16,000円以下は0円", () => {
  assert.equal(context.calcHousingAllowance(16000), 0);
});

test("calcHousingAllowance: 16,000円超〜27,000円は家賃-16,000円", () => {
  assert.equal(context.calcHousingAllowance(20000), 4000);
});

test("calcHousingAllowance: 27,000円超〜59,000円は11,000+(家賃-27,000)/2", () => {
  assert.equal(context.calcHousingAllowance(40000), 17500);
});

test("calcHousingAllowance: 59,000円超は上限28,000円", () => {
  assert.equal(context.calcHousingAllowance(100000), 28000);
});

// --- calcVehicleCommuteAllowance ----------------------------------------------------

test("calcVehicleCommuteAllowance: 2km未満は0円", () => {
  assert.equal(context.calcVehicleCommuteAllowance(1), 0);
});

test("calcVehicleCommuteAllowance: 5kmは4,200円（5km以上10km未満帯）", () => {
  assert.equal(context.calcVehicleCommuteAllowance(5), 4200);
});

test("calcVehicleCommuteAllowance: 60km以上は上限31,600円", () => {
  assert.equal(context.calcVehicleCommuteAllowance(100), 31600);
});

// --- calculateOvertimeAllowance -----------------------------------------------------

test("calculateOvertimeAllowance: 月60時間以下は通常の割増率のみ", () => {
  const r = context.calculateOvertimeAllowance(1000, {
    weekdayNormalHours: 30,
    weekdayNightHours: 10,
    holidayNormalHours: 0,
    holidayNightHours: 0,
  });
  // 30*1.25 + 10*1.5 = 37.5 + 15 = 52.5 -> 52500円
  assert.equal(r.totalAllowance, 52500);
  assert.equal(r.excessHours, 0);
});

test("calculateOvertimeAllowance: 月60時間超は超過分の割増率が上がる", () => {
  const r = context.calculateOvertimeAllowance(1000, {
    weekdayNormalHours: 50,
    weekdayNightHours: 20,
    holidayNormalHours: 0,
    holidayNightHours: 0,
  });
  // 40*1.25 + 10*1.5(超過分) + 20*1.5 = 50+15+30 = 95 -> 95000円
  assert.equal(r.totalAllowance, 95000);
  assert.equal(r.excessHours, 10);
});

test("calculateOvertimeAllowance: 休日勤務は60時間判定に含まれない", () => {
  const r = context.calculateOvertimeAllowance(1000, {
    weekdayNormalHours: 0,
    weekdayNightHours: 0,
    holidayNormalHours: 8,
    holidayNightHours: 2,
  });
  // 8*1.35 + 2*1.6 = 10.8+3.2 = 14 -> 14000円
  assert.equal(r.totalAllowance, 14000);
});

// --- calculateBonusWithPeriodRate ---------------------------------------------------

test("calculateBonusWithPeriodRate: 期間率1.0は満額の半分", () => {
  assert.equal(context.calculateBonusWithPeriodRate(300000, 4.9, 1.0), 735000);
});

test("calculateBonusWithPeriodRate: 期間率0.3は満額の0.3倍", () => {
  assert.equal(context.calculateBonusWithPeriodRate(300000, 4.9, 0.3), 220500);
});

// --- calculateSalary (統合テスト) ---------------------------------------------------

test("calculateSalary: 各手当と合計額が期待通り計算される", () => {
  const result = context.calculateSalary({
    tableKey: "test_graded",
    grade: 1,
    step: 2,
    regionalRate: 0.2,
    fiscalYear: "r8",
    hasSpouse: false,
    childCount: 2,
    parentCount: 0,
    housingType: "rent",
    rent: 70000,
    commuteType: "transit",
    commuteFare: 15000,
    bonusMonths: 4.9,
    weekdayNormalHours: 0,
    weekdayNightHours: 0,
    holidayNormalHours: 0,
    holidayNightHours: 0,
  });

  assert.equal(result.baseSalary, 101000);
  assert.equal(result.regionalAllowance, 20200); // 101000*0.2
  assert.equal(result.dependentAllowance, 26000); // 子2人 x 13000円(r8)
  assert.equal(result.housingAllowance, 28000); // 70000円は上限28000円
  assert.equal(result.commuteAllowance, 15000);
  assert.equal(result.monthlyTotal, 190200);
  assert.equal(result.overtimeAllowance, 0);
});

// --- 結果サマリ -----------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
