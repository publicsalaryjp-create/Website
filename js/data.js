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
 *  - 扶養手当: 人事院規則9-80、人事院「国家公務員の諸手当の概要」（令和8年4月現在）
 *  - 期末・勤勉手当の支給月数、勤勉手当の成績率: 人事院「国家公務員の諸手当の概要」（令和8年度）
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
  { value: 0.2, name: "1級地", example: "東京都特別区 ほか" },
  { value: 0.16, name: "2級地" },
  { value: 0.12, name: "3級地" },
  { value: 0.08, name: "4級地" },
  { value: 0.04, name: "5級地" },
  { value: 0, name: "非支給地" },
];

// ---------------------------------------------------------------------------
// 3. 扶養手当（令和8年度・現行のみ。配偶者手当は廃止済みのため対象外）
// ---------------------------------------------------------------------------

// 出典: 人事院「国家公務員の諸手当の概要」（令和8年4月現在）
// 子は15歳以下と、16歳の年度初め〜22歳の年度末（特定期間）とで額が異なり、
// 特定期間の子には基本額13,000円に5,000円が加算される（合計18,000円）。
const DEPENDENT_ALLOWANCE_RATES = {
  childUnder15: 13000, // 子（15歳以下）
  child16to22: 18000, // 子（16歳以上22歳以下、加算5,000円込み）
  parent: 6500, // 父母等（年度別の正式額は未確認）
};

// ---------------------------------------------------------------------------
// 4. 住居手当
// ---------------------------------------------------------------------------
// 家賃額からの自動計算はせず、支給がある場合に利用者が月額を直接入力する
// （既定値は0円）。計算ロジックはcalculateSalary()内でinput.housingAllowance
// をそのまま使用する。

// ---------------------------------------------------------------------------
// 4b. 本府省業務調整手当（本省手当）
// ---------------------------------------------------------------------------
// 本府省（霞が関）勤務の職員に支給される手当（給与法10条の3、人事院規則9-123）。
// 利用者は「支給の有無」のみを選び、金額は選択中の職務の級から自動計算する
// （級が7以上は「7級以上」の額を一律適用。級のない俸給表(flat型)を選んでいる
// 等で級が取得できない場合は0円）。計算ロジックはinput.honshoAllowanceを
// そのまま月額支給額の合計に算入する（超過勤務手当・期末勤勉手当の算定基礎額には
// 含めない簡略化。他の未算入の手当と合わせてPBI-008/PBI-009参照）。
//
// 下記はユーザー提供の令和8年度人事院公表資料（行政職俸給表(一)の級別月額表、画像）に
// 基づく値（出典の確度: 高）。旧来のWeb検索ベースの値（1級7,200円〜7級以上41,800円）から、
// 令和8年度人事院勧告による増額改定を反映して更新済み（課長補佐級相当は+10,000円程度、
// 係長級以下相当は+2,000円程度の増額、7級以上は51,800円）。行政職俸給表(一)以外の
// 俸給表については「相当する職務の級」への読み替えが必要な場合があるが、本ツールでは
// 選択中の俸給表によらず級番号をそのまま適用する簡略化としている。
const HONSHO_ALLOWANCE_REFERENCE = [
  { grade: "1級", gradeNumber: 1, amount: 9200 },
  { grade: "2級", gradeNumber: 2, amount: 10800 },
  { grade: "3級", gradeNumber: 3, amount: 19500 },
  { grade: "4級", gradeNumber: 4, amount: 24100 },
  { grade: "5級", gradeNumber: 5, amount: 47400 },
  { grade: "6級", gradeNumber: 6, amount: 49200 },
  { grade: "7級以上", gradeNumber: 7, amount: 51800 },
];

/** 職務の級から本省手当の参考額を求める。7級以上は一律「7級以上」の額。級が取得できない場合は0円 */
function getHonshoAllowanceAmount(grade) {
  const g = Number(grade);
  if (!g || g < 1) return 0;
  const entry = HONSHO_ALLOWANCE_REFERENCE.find((r) => r.gradeNumber === Math.min(g, 7));
  return entry ? entry.amount : 0;
}

// ---------------------------------------------------------------------------
// 5. 超過勤務手当（給与法第16条・人事院規則15-14に基づく割増率）
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
// 6. 期末手当・勤勉手当の在職期間別割合（期間率、人事院規則9-83別表を参考にした一般的な区分）
// ---------------------------------------------------------------------------

// 基準日（6月1日・12月1日）までの在職期間に応じて支給割合が下がる。新規採用者の初回賞与などに使う。
// 出典の確度: 中（Web検索の複数記事で一致した内容。法令原文とは未突合のため要確認）
const BONUS_PERIOD_RATES = [
  { value: 1.0, label: "6か月（全期間在職）" },
  { value: 0.8, label: "5か月以上6か月未満" },
  { value: 0.6, label: "3か月以上5か月未満" },
  { value: 0.3, label: "3か月未満" },
];

// ---------------------------------------------------------------------------
// 7. 勤勉手当の成績率（令和8年度、人事院公表資料に基づく）
// ---------------------------------------------------------------------------

// 出典: 人事院「国家公務員の諸手当の概要」（令和8年度）成績率表。
// 6月期・12月期で率は同一。階級幅がある区分（特に優秀・優秀）は下限値を採用している。
// rate: null の区分（指定職の「特に優秀」）は該当なしのため選択肢から除外する。
const MERIT_RATE_CATEGORIES = {
  general: {
    label: "一般職員",
    grades: [
      { key: "excellent_plus", label: "特に優秀（125.25/100以上、下限採用）", rate: 1.2525 },
      { key: "excellent", label: "優秀（113.75/100以上125.25/100未満、下限採用）", rate: 1.1375 },
      { key: "good", label: "良好（102.25/100）", rate: 1.0225 },
      { key: "not_good", label: "良好でない（93.75/100以下）", rate: 0.9375 },
    ],
  },
  senior_manager: {
    label: "特定管理職員（本府省課長等）",
    grades: [
      { key: "excellent_plus", label: "特に優秀（149.25/100以上、下限採用）", rate: 1.4925 },
      { key: "excellent", label: "優秀（134.75/100以上149.25/100未満、下限採用）", rate: 1.3475 },
      { key: "good", label: "良好（122.25/100）", rate: 1.2225 },
      { key: "not_good", label: "良好でない（112.75/100以下）", rate: 1.1275 },
    ],
  },
  designated: {
    label: "指定職職員",
    grades: [
      { key: "excellent_plus", label: "特に優秀（該当なし）", rate: null },
      { key: "excellent", label: "優秀（115/100以上215/100以下、下限採用）", rate: 1.15 },
      { key: "good", label: "良好（101.5/100。事務次官等は107.5/100）", rate: 1.015 },
      { key: "not_good", label: "良好でない（93/100以下）", rate: 0.93 },
    ],
  },
};
