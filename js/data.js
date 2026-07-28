/**
 * data.js
 * 国家公務員給与計算に使う各種データ（俸給表・手当額・支給率）を定義する。
 *
 * 俸給表は data/salary-tables.json（ユーザー提供の公式データ、行政職・公安職・
 * 教育職・医療職など20表）を読み込んで使用する。何らかの理由で読み込みに失敗
 * した場合（file:// で開いた等）は、行政職俸給表(一)のみ簡易な参考値で代替する。
 *
 * 出典（数値を直接確認したい場合）:
 *  - 俸給表（別表第一〜第十）: https://www.jinji.go.jp/content/900030877.pdf
 *  - 地域手当（級地区分）: 人事院規則9-49
 *  - 扶養手当・住居手当・通勤手当: 人事院規則9-80, 9-42, 9-24
 *  - 期末・勤勉手当の支給月数: 内閣人事局 給与関係資料
 */

// ---------------------------------------------------------------------------
// 1. 俸給表
// ---------------------------------------------------------------------------

// data/salary-tables.json が読み込めなかった場合の最終フォールバック（行政職(一)のみ、参考値）
const FALLBACK_GRADE_SEED = {
  1: { base: 145600, steps: 125 },
  2: { base: 177100, steps: 125 },
  3: { base: 208900, steps: 113 },
  4: { base: 236500, steps: 97 },
  5: { base: 260400, steps: 85 },
  6: { base: 285200, steps: 73 },
  7: { base: 313900, steps: 65 },
  8: { base: 350500, steps: 41 },
  9: { base: 379200, steps: 37 },
  10: { base: 411200, steps: 29 },
};

function generateFallbackSalaryTable() {
  const grades = {};
  for (const grade of Object.keys(FALLBACK_GRADE_SEED)) {
    const { base, steps } = FALLBACK_GRADE_SEED[grade];
    const amounts = [base];
    for (let step = 1; step < steps; step++) {
      const progress = step / steps;
      const raw = 1900 - progress * 1500;
      const increment = Math.max(200, Math.round(raw / 100) * 100);
      amounts.push(amounts[step - 1] + increment);
    }
    grades[grade] = amounts;
  }
  return grades;
}

const FALLBACK_CATALOG = {
  order: ["administrative_1"],
  tables: {
    administrative_1: {
      label: "行政職俸給表(一)相当（参考値・要確認）",
      type: "graded",
      grades: generateFallbackSalaryTable(),
    },
  },
};

// 俸給表カタログ（全俸給表を保持）。読み込み完了後に data/salary-tables.json の内容へ差し替わる。
let SALARY_CATALOG = FALLBACK_CATALOG;
let SALARY_CATALOG_IS_OFFICIAL = false;
let SALARY_CATALOG_SOURCE_NOTE = "";

// 俸給表のバージョン（現行／人事院勧告後など）一覧。data/vintages.json から読み込む。
const FALLBACK_VINTAGES = [
  { key: "current", label: "現行", file: "salary-tables.json", effectiveDate: null, available: true },
];
let SALARY_VINTAGES = FALLBACK_VINTAGES;
let CURRENT_VINTAGE_KEY = "current";

/**
 * data/vintages.json を読み込んで SALARY_VINTAGES を差し替える。読み込めない場合は
 * 「現行」バージョンのみのフォールバック一覧を使う。
 */
async function loadVintages() {
  try {
    const res = await fetch("data/vintages.json", { cache: "no-store" });
    if (!res.ok) return false;
    const json = await res.json();
    if (!json || !Array.isArray(json.vintages) || json.vintages.length === 0) return false;
    SALARY_VINTAGES = json.vintages;
    return true;
  } catch (e) {
    return false;
  }
}

function getVintage(vintageKey) {
  return SALARY_VINTAGES.find((v) => v.key === vintageKey);
}

/**
 * data/salary-tables.json（またはバージョンごとのファイル）を読み込んで SALARY_CATALOG を差し替える。
 * 期待するJSON形式:
 * {
 *   "source": "...", "note": "...", "effectiveDate": "YYYY-MM-DD",
 *   "order": ["administrative_1", ...],
 *   "tables": {
 *     "administrative_1": { "label": "行政職俸給表(一)", "type": "graded",
 *                            "grades": { "1": [195800, ...], ... } },
 *     "designated":       { "label": "指定職俸給表", "type": "flat",
 *                            "steps": [736000, ...] }
 *   }
 * }
 * file:// で開いている場合など fetch できない環境では黙ってフォールバックを使い続ける。
 *
 * @param {string} [file] 読み込むファイル名（省略時は "salary-tables.json"）
 */
async function loadOfficialSalaryTable(file) {
  try {
    const res = await fetch(`data/${file || "salary-tables.json"}`, { cache: "no-store" });
    if (!res.ok) return false;
    const json = await res.json();
    if (!json || typeof json.tables !== "object") return false;
    SALARY_CATALOG = json;
    SALARY_CATALOG_IS_OFFICIAL = true;
    SALARY_CATALOG_SOURCE_NOTE = json.note || "";
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 俸給表バージョンを切り替える。指定バージョンにデータファイルが登録されていない
 * (available: false または file: null) 場合は切り替えず false を返す。
 */
async function switchVintage(vintageKey) {
  const vintage = getVintage(vintageKey);
  if (!vintage || !vintage.available || !vintage.file) return false;
  const ok = await loadOfficialSalaryTable(vintage.file);
  if (ok) CURRENT_VINTAGE_KEY = vintageKey;
  return ok;
}

function getTableKeys() {
  return SALARY_CATALOG.order && SALARY_CATALOG.order.length
    ? SALARY_CATALOG.order
    : Object.keys(SALARY_CATALOG.tables);
}

function getTable(tableKey) {
  return SALARY_CATALOG.tables[tableKey];
}

// ---------------------------------------------------------------------------
// 2. 地域手当（令和6年人事院勧告後の5区分制度）
// ---------------------------------------------------------------------------

const REGIONAL_ALLOWANCE_RATES = [
  { value: 0.2, label: "1級地（20%）例：東京都特別区 ほか" },
  { value: 0.16, label: "2級地（16%）" },
  { value: 0.12, label: "3級地（12%）" },
  { value: 0.08, label: "4級地（8%）" },
  { value: 0.04, label: "5級地（4%）" },
  { value: 0, label: "非支給地（0%）" },
];

// ---------------------------------------------------------------------------
// 3. 扶養手当（配偶者手当は段階的に廃止され、子の手当額が引き上げられている）
// ---------------------------------------------------------------------------

const DEPENDENT_ALLOWANCE_SCHEDULE = {
  r6: { label: "令和6年度（2024年4月〜）", spouse: 6500, child: 10000, parent: 6500 },
  r7: { label: "令和7年度（2025年4月〜）", spouse: 3000, child: 11500, parent: 6500 },
  r8: { label: "令和8年度（2026年4月〜・現行）", spouse: 0, child: 13000, parent: 6500 },
};

// ---------------------------------------------------------------------------
// 4. 住居手当（賃貸住宅、月額家賃に応じた支給額）
// ---------------------------------------------------------------------------

function calcHousingAllowance(rent) {
  if (!rent || rent <= 16000) return 0;
  if (rent <= 27000) return rent - 16000;
  if (rent <= 59000) return Math.floor(11000 + (rent - 27000) / 2);
  return 28000;
}

// ---------------------------------------------------------------------------
// 5. 通勤手当
// ---------------------------------------------------------------------------

const COMMUTE_TRANSIT_CAP = 55000; // 公共交通機関利用者の月額上限

// 自動車等の交通用具使用者（片道距離に応じた月額、参考値）
const COMMUTE_VEHICLE_TABLE = [
  { maxKm: 2, amount: 0 },
  { maxKm: 5, amount: 2000 },
  { maxKm: 10, amount: 4200 },
  { maxKm: 15, amount: 7100 },
  { maxKm: 20, amount: 10000 },
  { maxKm: 25, amount: 12900 },
  { maxKm: 30, amount: 15800 },
  { maxKm: 35, amount: 18700 },
  { maxKm: 40, amount: 21600 },
  { maxKm: 45, amount: 24400 },
  { maxKm: 50, amount: 26200 },
  { maxKm: 55, amount: 28000 },
  { maxKm: 60, amount: 29800 },
  { maxKm: Infinity, amount: 31600 },
];

function calcVehicleCommuteAllowance(oneWayKm) {
  if (!oneWayKm || oneWayKm < 2) return 0;
  for (const row of COMMUTE_VEHICLE_TABLE) {
    if (oneWayKm < row.maxKm) return row.amount;
  }
  return COMMUTE_VEHICLE_TABLE[COMMUTE_VEHICLE_TABLE.length - 1].amount;
}

// ---------------------------------------------------------------------------
// 6. 超過勤務手当（給与法第16条・人事院規則15-14に基づく割増率）
// ---------------------------------------------------------------------------

// 1週間の正規の勤務時間（38時間45分）。年間所定勤務時間 = WEEKLY_HOURS × 52 として時間単価を算定する。
const WEEKLY_SCHEDULED_HOURS = 38 + 45 / 60;
const ANNUAL_SCHEDULED_HOURS = WEEKLY_SCHEDULED_HOURS * 52;

// 月60時間以下 / 60時間超で切り替わる割増率
const OVERTIME_RATES = {
  weekdayNormal: 1.25, // 平日の時間外勤務（22時まで）
  weekdayNight: 1.5, // 平日の時間外勤務のうち深夜（22時〜翌5時）
  weekdayNormalOver60: 1.5, // 月60時間超の部分（22時まで）
  weekdayNightOver60: 1.75, // 月60時間超の部分のうち深夜
  holidayNormal: 1.35, // 休日勤務（22時まで）
  holidayNight: 1.6, // 休日勤務のうち深夜（22時〜翌5時）
};

const OVERTIME_MONTHLY_THRESHOLD_HOURS = 60; // これを超えた時間外勤務（休日勤務を除く）から割増率が上がる

// ---------------------------------------------------------------------------
// 7. 期末手当・勤勉手当の在職期間別割合（期間率、人事院規則9-83別表を参考にした一般的な区分）
// ---------------------------------------------------------------------------

// 基準日（6月1日・12月1日）までの在職期間に応じて支給割合が下がる。新規採用者の初回賞与などに使う。
// 出典の確度: 中（Web検索の複数記事で一致した内容。法令原文とは未突合のため要確認）
const BONUS_PERIOD_RATES = [
  { value: 1.0, label: "6か月（全期間在職）" },
  { value: 0.8, label: "5か月以上6か月未満" },
  { value: 0.6, label: "3か月以上5か月未満" },
  { value: 0.3, label: "3か月未満" },
];
