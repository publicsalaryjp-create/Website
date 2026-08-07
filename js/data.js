/**
 * data.js
 * 国家公務員給与計算に使う各種データ（俸給表・手当額・支給率）を定義する。
 *
 * 俸給表は data/salary-tables-r8.json（ユーザー提供の公式データ、行政職・公安職・
 * 教育職・医療職など19表）を読み込んで使用する。何らかの理由で読み込みに失敗
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

// data/salary-tables-r8.json が読み込めなかった場合の最終フォールバック（行政職(一)のみ、参考値）
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

// 俸給表カタログ（全俸給表を保持）。読み込み完了後に data/salary-tables-r8.json の内容へ差し替わる。
let SALARY_CATALOG = FALLBACK_CATALOG;
let SALARY_CATALOG_IS_OFFICIAL = false;
let SALARY_CATALOG_SOURCE_NOTE = "";

// 俸給表のバージョン（現行／人事院勧告後など）一覧。data/vintages.json から読み込む。
const FALLBACK_VINTAGES = [
  { key: "current", label: "現行", file: "salary-tables-r8.json", effectiveDate: null, available: true },
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
 * data/salary-tables-r8.json（またはバージョンごとのファイル）を読み込んで SALARY_CATALOG を差し替える。
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
 * @param {string} [file] 読み込むファイル名（省略時は "salary-tables-r8.json"）
 */
async function loadOfficialSalaryTable(file) {
  try {
    const res = await fetch(`data/${file || "salary-tables-r8.json"}`, { cache: "no-store" });
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

// 「現行」（令和8年4月1日施行）の俸給表カタログを、選択中のバージョンとは独立に保持する。
// 人事院勧告反映後（またはそれ以外の非現行バージョン）を選んだ際に、「勧告前からいくら
// 増えたか」を計算結果に併記するための比較基準として使う。
let BASELINE_SALARY_CATALOG = null;

/** 「現行」バージョンの俸給表データを読み込み、BASELINE_SALARY_CATALOGにキャッシュする。 */
async function loadBaselineSalaryTable() {
  const baseline = getVintage("current");
  if (!baseline || !baseline.file) return false;
  try {
    const res = await fetch(`data/${baseline.file}`, { cache: "no-store" });
    if (!res.ok) return false;
    const json = await res.json();
    if (!json || typeof json.tables !== "object") return false;
    BASELINE_SALARY_CATALOG = json;
    return true;
  } catch (e) {
    return false;
  }
}

/** 選択中の俸給表バージョンが「現行」以外で、比較基準データも読み込み済みかどうか。
 * trueのときだけ計算結果に「勧告前との差額」を表示する。 */
function hasVintageComparison() {
  return CURRENT_VINTAGE_KEY !== "current" && !!BASELINE_SALARY_CATALOG;
}

function getTableKeys() {
  return SALARY_CATALOG.order && SALARY_CATALOG.order.length
    ? SALARY_CATALOG.order
    : Object.keys(SALARY_CATALOG.tables);
}

function getTable(tableKey) {
  return SALARY_CATALOG.tables[tableKey];
}

// 選択肢に表示する俸給表を一旦、行政職俸給表(一)・指定職俸給表の2表に絞る
// （ユーザー指示。俸給表データファイル自体は各バージョンとも全19表を保持したまま）。
const VISIBLE_TABLE_KEYS = ["administrative_1", "designated"];

function getVisibleTableKeys() {
  return getTableKeys().filter((key) => VISIBLE_TABLE_KEYS.includes(key));
}

/**
 * 昇格時号俸対応表から、1級上の職務の級に昇格した際の号俸を返す。
 * 対応表を持たない俸給表・号俸の場合は null を返す。
 */
function getPromotionTargetStep(tableKey, targetGrade, sourceStep) {
  if (typeof PROMOTION_STEP_MAPPINGS === "undefined") return null;
  const table = PROMOTION_STEP_MAPPINGS.tables && PROMOTION_STEP_MAPPINGS.tables[tableKey];
  const targetMapping = table && table[String(targetGrade)];
  const step = targetMapping && targetMapping[String(sourceStep)];
  return Number.isInteger(step) ? step : null;
}

// ---------------------------------------------------------------------------
// 2. 地域手当（令和6年人事院勧告後の5区分制度）
// ---------------------------------------------------------------------------

// 令和8年度は制度の段階的見直し期間中のため、級地区分だけでなく地域ごとに
// 1%刻みの経過措置割合がある。公式シミュレーター収録データから使われる割合を生成する。
const REGIONAL_ALLOWANCE_RATES = [...new Set(REGIONAL_ALLOWANCE_LOCATIONS.map((location) => location.rate))]
  .sort((a, b) => b - a)
  .map((value) => ({ value, name: value === 0 ? "非支給地" : `${value * 100}%` }));

// ---------------------------------------------------------------------------
// 3. 扶養手当（令和8年度・現行のみ。配偶者手当は廃止済みのため対象外）
// ---------------------------------------------------------------------------

// 出典: 人事院「国家公務員の諸手当の概要」（令和8年4月現在）
// 子は15歳以下と、16歳の年度初め〜22歳の年度末（特定期間）とで額が異なり、
// 特定期間の子には基本額13,000円に5,000円が加算される（合計18,000円）。
const DEPENDENT_ALLOWANCE_RATES = {
  childUnder15: 13000, // 子（15歳以下）
  child16to22: 18000, // 子（16歳以上22歳以下、加算5,000円込み）
  parent: 6500, // 父母等（行政職俸給表(一)8級以上は下記PARENT_ALLOWANCE_GRADE_OVERRIDESで減額・不支給）
};

// 父母等の扶養手当は、行政職俸給表(一)の職務の級が上がると減額・不支給となる
// （行政職俸給表(一)8級職員等は3,500円、9級以上職員等は支給なし）。
// この読み替えは行政職俸給表(一)を選択している場合のみ適用し、それ以外の俸給表
// （指定職俸給表など）を選んでいる場合は簡略化のため一律 DEPENDENT_ALLOWANCE_RATES.parent とする
// （本省手当の「相当する職務の級」の読み替えを省略する簡略化と同様の考え方）。
const PARENT_ALLOWANCE_GRADE_OVERRIDE_TABLE_KEY = "administrative_1";
const PARENT_ALLOWANCE_GRADE_OVERRIDES = {
  8: 3500,
  9: 0,
};

function getParentAllowanceRate(tableKey, grade) {
  if (tableKey === PARENT_ALLOWANCE_GRADE_OVERRIDE_TABLE_KEY) {
    if (grade >= 9) return PARENT_ALLOWANCE_GRADE_OVERRIDES[9];
    if (grade === 8) return PARENT_ALLOWANCE_GRADE_OVERRIDES[8];
  }
  return DEPENDENT_ALLOWANCE_RATES.parent;
}

// ---------------------------------------------------------------------------
// 4. 俸給の特別調整額（管理職手当）
// ---------------------------------------------------------------------------
// 出典: 人事院規則九―一七（俸給の特別調整額）別表第一 一 行政職俸給表（一）。
// 本府省課長・室長級以上等の管理監督職員に、超過勤務手当に代えて支給される定額の手当。
// 職務の級ごとに支給対象となる区分（一種〜五種）と定額が定められている
// （1〜3級は支給対象区分がなく、この手当は支給されない）。
const SPECIAL_ADJUSTMENT_ALLOWANCE_TABLE = {
  administrative_1: {
    10: [{ key: "type1", label: "一種", amount: 139300 }],
    9: [
      { key: "type1", label: "一種", amount: 130300 },
      { key: "type2", label: "二種", amount: 104200 },
    ],
    8: [
      { key: "type1", label: "一種", amount: 117500 },
      { key: "type2", label: "二種", amount: 94000 },
      { key: "type3", label: "三種", amount: 82200 },
    ],
    7: [
      { key: "type2", label: "二種", amount: 88500 },
      { key: "type3", label: "三種", amount: 77400 },
      { key: "type4", label: "四種", amount: 66400 },
    ],
    6: [
      { key: "type3", label: "三種", amount: 72700 },
      { key: "type4", label: "四種", amount: 62300 },
      { key: "type5", label: "五種", amount: 51900 },
    ],
    5: [
      { key: "type4", label: "四種", amount: 59500 },
      { key: "type5", label: "五種", amount: 49600 },
    ],
    4: [
      { key: "type4", label: "四種", amount: 55500 },
      { key: "type5", label: "五種", amount: 46300 },
    ],
  },
};

/** 指定した俸給表・職務の級で選択可能な俸給の特別調整額の区分一覧を返す（対象外の級は空配列） */
function getSpecialAdjustmentOptions(tableKey, grade) {
  const table = SPECIAL_ADJUSTMENT_ALLOWANCE_TABLE[tableKey];
  return (table && table[grade]) || [];
}

/** 指定した俸給表・職務の級・区分キーに対応する俸給の特別調整額（円）を返す（該当なしは0円） */
function getSpecialAdjustmentAmount(tableKey, grade, categoryKey) {
  const options = getSpecialAdjustmentOptions(tableKey, grade);
  const option = options.find((o) => o.key === categoryKey);
  return option ? option.amount : 0;
}

// 期末・勤勉手当の管理職加算。人事院規則九―四〇第四条の四に基づき、
// 俸給の特別調整額の区分が一種は25%、二種は15%。三種以下は本ツールでは対象外とする。
const MANAGEMENT_BONUS_ADDITION_RATES = {
  type1: 0.25,
  type2: 0.15,
};

/** 俸給の特別調整額の区分に対応する期末・勤勉手当の管理職加算割合を返す。 */
function getManagementBonusAdditionRate(categoryKey) {
  return MANAGEMENT_BONUS_ADDITION_RATES[categoryKey] || 0;
}

// ---------------------------------------------------------------------------
// 5. 住居手当
// ---------------------------------------------------------------------------
// 借家・借間に住み、実際に家賃を支払っている場合のみ支給される。
// 家賃月額が16,000円を超える場合に支給される。27,000円以下では「家賃−16,000円」、
// 27,000円超では「11,000円＋（家賃−27,000円）の半額」（上限28,000円）で計算する。
const HOUSING_ALLOWANCE_MIN_RENT = 16000;
const HOUSING_ALLOWANCE_THRESHOLD_RENT = 27000;
const HOUSING_ALLOWANCE_BASE_AMOUNT = 11000;
const HOUSING_ALLOWANCE_ADDITIONAL_CAP = 17000;
const HOUSING_ALLOWANCE_CAP = 28000;

/** 家賃月額から住居手当を計算する。人事院規則に基づく段階式（100円未満切り捨て）。 */
function calcHousingAllowance(rent) {
  const r = Math.max(0, Math.floor(Number(rent) || 0));
  if (r <= HOUSING_ALLOWANCE_MIN_RENT) return 0;
  const amount = r <= HOUSING_ALLOWANCE_THRESHOLD_RENT
    ? r - HOUSING_ALLOWANCE_MIN_RENT
    : HOUSING_ALLOWANCE_BASE_AMOUNT + Math.min(
      Math.floor((r - HOUSING_ALLOWANCE_THRESHOLD_RENT) / 2),
      HOUSING_ALLOWANCE_ADDITIONAL_CAP
    );
  return Math.floor(amount / 100) * 100;
}

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

/**
 * 俸給表の種類に応じた本省手当の参考額を求める。
 * 指定職俸給表など「級」の概念がないflat型の俸給表では、UI上も職務の級を選択させて
 * いないため、選択欄に残った値（別の俸給表を選んでいた際の名残）を参照すると誤った額に
 * なる（PBI-XXX参照）。指定職職員は行政職俸給表(一)7級以上に相当する職務にあるため、
 * 一律「7級以上」の額を適用する（本省手当の「相当する職務の級」の読み替えを省略する
 * 簡略化、他の俸給表・扶養手当の簡略化と同様の考え方）。
 */
function getHonshoAllowanceAmountForTable(tableKey, grade) {
  const table = getTable(tableKey);
  if (table && table.type !== "graded") {
    return getHonshoAllowanceAmount(7);
  }
  return getHonshoAllowanceAmount(grade);
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

// 期末手当の支給月数。実データは data/allowance-rates.json から読み込む。
let ALLOWANCE_RATES = null;

async function loadAllowanceRates() {
  const res = await fetch("data/allowance-rates.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`手当率データを読み込めませんでした（HTTP ${res.status}）`);
  const json = await res.json();
  const terminal = json && json.terminalAllowance;
  const roleStageRates = json && json.bonusRoleStageAdditionRates;
  const staffTypes = ["general", "senior_manager", "designated"];
  const periods = ["2026-06", "2026-12"];
  if (!terminal || !roleStageRates || !Number.isFinite(roleStageRates.designated) ||
    !roleStageRates.administrative_1 || staffTypes.some((type) =>
    !terminal[type] || periods.some((period) => !Number.isFinite(terminal[type][period]))
  )) {
    throw new Error("手当率データの期末手当支給月数が不正です");
  }
  ALLOWANCE_RATES = json;
}

function getBonusRoleStageAdditionRate(tableKey, grade) {
  const rates = ALLOWANCE_RATES.bonusRoleStageAdditionRates;
  if (tableKey === "designated") return rates.designated;
  if (tableKey !== "administrative_1") return 0;
  return rates.administrative_1[String(grade)] || 0;
}

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
      { key: "excellent_plus", label: "特に優秀（125.25/100以上318.75/100以下）", rate: 1.2525, minRate: 1.2525, maxRate: 3.1875 },
      { key: "excellent", label: "優秀（113.75/100以上125.25/100未満）", rate: 1.1375, minRate: 1.1375, maxRate: 1.2524 },
      { key: "good", label: "良好（102.25/100）", rate: 1.0225, minRate: 1.0225, maxRate: 1.0225 },
      { key: "not_good", label: "良好でない（93.75/100以下）", rate: 0.9375, minRate: 0, maxRate: 0.9375 },
    ],
  },
  senior_manager: {
    label: "特定管理職員（本府省課長等）",
    grades: [
      { key: "excellent_plus", label: "特に優秀（149.25/100以上378.75/100以下）", rate: 1.4925, minRate: 1.4925, maxRate: 3.7875 },
      { key: "excellent", label: "優秀（134.75/100以上149.25/100未満）", rate: 1.3475, minRate: 1.3475, maxRate: 1.4924 },
      { key: "good", label: "良好（122.25/100）", rate: 1.2225, minRate: 1.2225, maxRate: 1.2225 },
      { key: "not_good", label: "良好でない（112.75/100以下）", rate: 1.1275, minRate: 0, maxRate: 1.1275 },
    ],
  },
  designated: {
    label: "指定職職員",
    grades: [
      { key: "excellent_plus", label: "特に優秀（該当なし）", rate: null },
      { key: "excellent", label: "優秀（115/100以上215/100以下。8号は107.5/100固定）", rate: 1.15, minRate: 1.15, maxRate: 2.15 },
      { key: "good", label: "良好（101.5/100）", rate: 1.015, minRate: 1.015, maxRate: 1.015 },
      { key: "not_good", label: "良好でない（93/100以下）", rate: 0.93, minRate: 0, maxRate: 0.93 },
    ],
  },
};

// 指定職俸給表8号（事務次官等）は「優秀」の成績率が固定値107.5/100となる特例。
const DESIGNATED_STEP8_EXCELLENT_RATE = 1.075;
