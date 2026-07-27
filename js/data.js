/**
 * data.js
 * 国家公務員給与計算に使う各種データ（俸給表・手当額・支給率）を定義する。
 *
 * ⚠️ 俸給表（SALARY_TABLE）は人事院公表の正式な官報別表を取得できなかったため、
 *    実在の俸給表の"形状"（級が上がるほど号俸間の昇給額が小さくなるカーブ）を
 *    模した参考値（推定値）です。正確な金額ではありません。
 *    正式データが手に入り次第 data/salary-table.json に配置してください。
 *    読み込みは loadOfficialSalaryTable() が自動で試みます（無ければ参考値を使用）。
 *
 * 出典（数値を直接確認したい場合）:
 *  - 俸給表（別表第一）: https://www.jinji.go.jp/content/900030877.pdf
 *  - 地域手当（級地区分）: 人事院規則9-49
 *  - 扶養手当・住居手当・通勤手当: 人事院規則9-80, 9-42, 9-24
 *  - 期末・勤勉手当の支給月数: 内閣人事局 給与関係資料
 */

// ---------------------------------------------------------------------------
// 1. 俸給表（行政職俸給表(一) 相当の参考値）
// ---------------------------------------------------------------------------

// 各級の1号俸の額（円）と号俸数（参考値）
const GRADE_SEED = {
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

// 号俸が上がるほど昇給額が小さくなるカーブを模した参考テーブルを生成する。
function generateReferenceSalaryTable() {
  const table = {};
  for (const grade of Object.keys(GRADE_SEED)) {
    const { base, steps } = GRADE_SEED[grade];
    const amounts = [base];
    for (let step = 1; step < steps; step++) {
      const progress = step / steps; // 0〜1
      const raw = 1900 - progress * 1500; // 昇給額は1,900円→400円へ逓減
      const increment = Math.max(200, Math.round(raw / 100) * 100);
      amounts.push(amounts[step - 1] + increment);
    }
    table[grade] = amounts;
  }
  return table;
}

const REFERENCE_SALARY_TABLE = generateReferenceSalaryTable();

// 実際に使用する俸給表（初期値は参考値。公式データがあれば差し替えられる）
let SALARY_TABLE = REFERENCE_SALARY_TABLE;
let SALARY_TABLE_IS_OFFICIAL = false;
let SALARY_TABLE_META = { table: "行政職俸給表(一) 相当（参考値）", effectiveDate: null };

/**
 * data/salary-table.json が配置されていれば読み込んで SALARY_TABLE を差し替える。
 * 期待するJSON形式:
 * {
 *   "table": "行政職俸給表(一)",
 *   "effectiveDate": "2025-04-01",
 *   "grades": { "1": [145600, 146700, ...], "2": [...], ... }
 * }
 * file:// で開いている場合など fetch できない環境では黙って参考値を使い続ける。
 */
async function loadOfficialSalaryTable() {
  try {
    const res = await fetch("data/salary-table.json", { cache: "no-store" });
    if (!res.ok) return false;
    const json = await res.json();
    if (!json || typeof json.grades !== "object") return false;
    SALARY_TABLE = json.grades;
    SALARY_TABLE_IS_OFFICIAL = true;
    SALARY_TABLE_META = {
      table: json.table || "行政職俸給表(一)",
      effectiveDate: json.effectiveDate || null,
    };
    return true;
  } catch (e) {
    return false;
  }
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
