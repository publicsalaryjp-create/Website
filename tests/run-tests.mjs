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

// MERIT_RATE_CATEGORIES も data.js 内で `const` 宣言されているため、
// context のプロパティとしては見えない。コンテキスト内で式を評価して取り出す。
const MERIT_RATE_CATEGORIES = vm.runInContext("MERIT_RATE_CATEGORIES", context);

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

test("calculateOvertimeAllowance: 平日時間外がちょうど60時間の場合は超過扱いにならない（境界値）", () => {
  const r = context.calculateOvertimeAllowance(1000, {
    weekdayNormalHours: 50,
    weekdayNightHours: 10,
    holidayNormalHours: 0,
    holidayNightHours: 0,
  });
  // 合計60時間ちょうど -> 超過なし。50*1.25 + 10*1.5 = 62.5+15 = 77.5 -> 77500円
  assert.equal(r.excessHours, 0);
  assert.equal(r.totalAllowance, 77500);
});

test("calculateOvertimeAllowance: 平日時間外が60.5時間の場合は0.5時間分だけ超過扱いになる（境界値）", () => {
  const r = context.calculateOvertimeAllowance(1000, {
    weekdayNormalHours: 50.5,
    weekdayNightHours: 10,
    holidayNormalHours: 0,
    holidayNightHours: 0,
  });
  // 合計60.5時間 -> 0.5時間だけ超過。50*1.25 + 0.5*1.5(超過分) + 10*1.5 = 62.5+0.75+15 = 78.25 -> 78250円
  assert.equal(r.excessHours, 0.5);
  assert.equal(r.totalAllowance, 78250);
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
    childUnder15Count: 1,
    child16to22Count: 1,
    parentCount: 1,
    housingAllowance: 20000,
    honshoAllowance: 10000,
    teishuMonths: 2.45,
    kinbenMonths: 2.45,
    meritRateJune: MERIT_RATE_CATEGORIES.general.grades.find((g) => g.key === "good").rate,
    meritRateDecember: MERIT_RATE_CATEGORIES.general.grades.find((g) => g.key === "good").rate,
    weekdayNormalHours: 0,
    weekdayNightHours: 0,
    holidayNormalHours: 0,
    holidayNightHours: 0,
  });

  assert.equal(result.baseSalary, 101000);
  assert.equal(result.regionalAllowance, 20200); // 101000*0.2
  assert.equal(result.dependentAllowance, 37500); // 15歳以下の子1人13000 + 16-22歳の子1人18000 + 父母等1人6500
  assert.equal(result.housingAllowance, 20000); // 直接入力した値がそのまま使われる
  assert.equal(result.honshoAllowance, 10000); // 直接入力した値がそのまま使われる
  assert.equal(result.monthlyTotal, 188700);
  assert.equal(result.overtimeAllowance, 0);
});

test("calculateSalary: 本省手当は月額支給額合計に算入されるが、超過勤務手当・期末勤勉手当の算定基礎には含まれない", () => {
  const withoutHonsho = context.calculateSalary({
    tableKey: "test_graded",
    grade: 1,
    step: 1, // baseSalary=100000
    regionalRate: 0,
    childUnder15Count: 0,
    child16to22Count: 0,
    parentCount: 0,
    housingAllowance: 0,
    honshoAllowance: 0,
    teishuMonths: 2.45,
    kinbenMonths: 2.45,
    meritRateJune: 1,
    meritRateDecember: 1,
    weekdayNormalHours: 10,
    weekdayNightHours: 0,
    holidayNormalHours: 0,
    holidayNightHours: 0,
  });
  const withHonsho = context.calculateSalary({
    tableKey: "test_graded",
    grade: 1,
    step: 1,
    regionalRate: 0,
    childUnder15Count: 0,
    child16to22Count: 0,
    parentCount: 0,
    housingAllowance: 0,
    honshoAllowance: 17500,
    teishuMonths: 2.45,
    kinbenMonths: 2.45,
    meritRateJune: 1,
    meritRateDecember: 1,
    weekdayNormalHours: 10,
    weekdayNightHours: 0,
    holidayNormalHours: 0,
    holidayNightHours: 0,
  });
  assert.equal(withHonsho.monthlyTotal, withoutHonsho.monthlyTotal + 17500);
  assert.equal(withHonsho.overtimeAllowance, withoutHonsho.overtimeAllowance); // 算定基礎に含まれないため残業代は不変
  assert.equal(withHonsho.teishuJune, withoutHonsho.teishuJune); // 賞与算定基礎にも含まれない
  assert.equal(withHonsho.kinbenJune, withoutHonsho.kinbenJune);
});

test("calculateSalary: 扶養手当は15歳以下と16〜22歳で額が異なる", () => {
  const under15 = context.calculateSalary({
    tableKey: "test_graded",
    grade: 1,
    step: 1,
    regionalRate: 0,
    childUnder15Count: 1,
    child16to22Count: 0,
    parentCount: 0,
    housingAllowance: 0,
    teishuMonths: 0,
    kinbenMonths: 0,
    meritRateJune: 1,
    meritRateDecember: 1,
    weekdayNormalHours: 0,
    weekdayNightHours: 0,
    holidayNormalHours: 0,
    holidayNightHours: 0,
  });
  const age16to22 = context.calculateSalary({
    tableKey: "test_graded",
    grade: 1,
    step: 1,
    regionalRate: 0,
    childUnder15Count: 0,
    child16to22Count: 1,
    parentCount: 0,
    housingAllowance: 0,
    teishuMonths: 0,
    kinbenMonths: 0,
    meritRateJune: 1,
    meritRateDecember: 1,
    weekdayNormalHours: 0,
    weekdayNightHours: 0,
    holidayNormalHours: 0,
    holidayNightHours: 0,
  });
  assert.equal(under15.dependentAllowance, 13000);
  assert.equal(age16to22.dependentAllowance, 18000);
});

// --- 期末・勤勉手当（6月/12月split・成績率） --------------------------------------

test("calculateSalary: 期末手当は成績率の影響を受けず、勤勉手当だけに成績率がかかる", () => {
  const result = context.calculateSalary({
    tableKey: "test_graded",
    grade: 1,
    step: 1, // baseSalary=100000
    regionalRate: 0,
    childUnder15Count: 0,
    child16to22Count: 0,
    parentCount: 0,
    housingAllowance: 0,
    teishuMonths: 2.45,
    kinbenMonths: 2.45,
    meritRateJune: 1.0225, // 一般職員「良好」
    meritRateDecember: 1.0225,
    weekdayNormalHours: 0,
    weekdayNightHours: 0,
    holidayNormalHours: 0,
    holidayNightHours: 0,
  });
  // bonusBase=100000, 半期分月数=2.45/2=1.225
  // 期末手当(6月)=floor(100000*1.225)=122500（成績率なし）
  // 勤勉手当(6月)=floor(100000*1.225*1.0225)=125256（成績率あり）
  assert.equal(result.teishuJune, 122500);
  assert.equal(result.teishuDecember, 122500);
  assert.equal(result.kinbenJune, 125256);
  assert.equal(result.kinbenDecember, 125256);
  assert.equal(result.bonusJune, result.teishuJune + result.kinbenJune);
  assert.equal(result.bonusAnnual, result.bonusJune + result.bonusDecember);
});

test("calculateSalary: 6月期と12月期で異なる成績率を設定すると勤勉手当だけ期ごとに変わる", () => {
  const result = context.calculateSalary({
    tableKey: "test_graded",
    grade: 1,
    step: 1, // baseSalary=100000
    regionalRate: 0,
    childUnder15Count: 0,
    child16to22Count: 0,
    parentCount: 0,
    housingAllowance: 0,
    teishuMonths: 2.45,
    kinbenMonths: 2.45,
    meritRateJune: MERIT_RATE_CATEGORIES.general.grades.find((g) => g.key === "excellent_plus").rate,
    meritRateDecember: MERIT_RATE_CATEGORIES.general.grades.find((g) => g.key === "not_good").rate,
    weekdayNormalHours: 0,
    weekdayNightHours: 0,
    holidayNormalHours: 0,
    holidayNightHours: 0,
  });
  assert.equal(result.teishuJune, result.teishuDecember); // 期末手当は成績率と無関係なので6月・12月で同額
  assert.notEqual(result.kinbenJune, result.kinbenDecember);
  assert.ok(result.kinbenJune > result.kinbenDecember); // 6月は「特に優秀」、12月は「良好でない」
});

test("calculateSalary: 一般職員の成績区分ごとに勤勉手当が変わる（下限値を採用）", () => {
  const baseInput = {
    tableKey: "test_graded",
    grade: 1,
    step: 1, // baseSalary=100000
    regionalRate: 0,
    childUnder15Count: 0,
    child16to22Count: 0,
    parentCount: 0,
    housingAllowance: 0,
    teishuMonths: 0,
    kinbenMonths: 2.0,
    weekdayNormalHours: 0,
    weekdayNightHours: 0,
    holidayNormalHours: 0,
    holidayNightHours: 0,
  };
  const grades = MERIT_RATE_CATEGORIES.general.grades;
  const rateFor = (key) => grades.find((g) => g.key === key).rate;

  const excellentPlus = context.calculateSalary({ ...baseInput, meritRateJune: rateFor("excellent_plus") });
  const excellent = context.calculateSalary({ ...baseInput, meritRateJune: rateFor("excellent") });
  const good = context.calculateSalary({ ...baseInput, meritRateJune: rateFor("good") });
  const notGood = context.calculateSalary({ ...baseInput, meritRateJune: rateFor("not_good") });

  // kinbenJune = floor(100000 * 1.0 * meritRate)
  assert.equal(excellentPlus.kinbenJune, 125250); // 1.2525
  assert.equal(excellent.kinbenJune, 113750); // 1.1375
  assert.equal(good.kinbenJune, 102250); // 1.0225
  assert.equal(notGood.kinbenJune, 93750); // 0.9375
  assert.ok(excellentPlus.kinbenJune > excellent.kinbenJune);
  assert.ok(excellent.kinbenJune > good.kinbenJune);
  assert.ok(good.kinbenJune > notGood.kinbenJune);
});

// --- 結果サマリ -----------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
