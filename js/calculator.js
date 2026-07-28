/**
 * calculator.js
 * 入力値から各種給与項目を計算する純粋関数群。DOM には触れない。
 */

function getStepAmounts(tableKey, grade) {
  const table = getTable(tableKey);
  if (!table) return [];
  if (table.type === "flat") return table.steps || [];
  return (table.grades && table.grades[String(grade)]) || [];
}

function getSalaryAmount(tableKey, grade, step) {
  const amounts = getStepAmounts(tableKey, grade);
  if (!amounts.length) return 0;
  const index = Math.min(Math.max(step - 1, 0), amounts.length - 1);
  return amounts[index];
}

function getMaxStep(tableKey, grade) {
  const amounts = getStepAmounts(tableKey, grade);
  return amounts.length || 1;
}

/**
 * 勤務1時間当たりの給与額を算定する。
 * 算定基礎額（俸給月額＋地域手当＋扶養手当）× 12ヶ月 ÷ 年間所定勤務時間（週38時間45分×52週）。
 * 住居手当・通勤手当は実費補填的な手当のため算定基礎に含めない。
 */
function calcHourlyWage(overtimeBase) {
  return (overtimeBase * 12) / ANNUAL_SCHEDULED_HOURS;
}

/**
 * 超過勤務手当を、平日/休日 × 深夜有無 × 月60時間超過の有無で区分して計算する。
 * 月60時間の判定対象は休日勤務を除く時間外勤務（深夜時間帯を含む）の合計時間。
 * 60時間を超えた分は、平日の通常時間から優先的に充当し、それでも足りなければ深夜時間に充当する
 * （実際の勤務順序までは把握できないための簡便な割当てであることに留意）。
 *
 * @param {number} hourlyWage 勤務1時間当たりの給与額
 * @param {Object} hours
 * @param {number} hours.weekdayNormalHours 平日の時間外勤務時間（深夜を除く月間合計）
 * @param {number} hours.weekdayNightHours 平日の時間外勤務時間のうち深夜（22時〜翌5時）
 * @param {number} hours.holidayNormalHours 休日勤務時間（深夜を除く月間合計）
 * @param {number} hours.holidayNightHours 休日勤務時間のうち深夜（22時〜翌5時）
 */
function calculateOvertimeAllowance(hourlyWage, hours) {
  const weekdayNormalHours = Math.max(0, hours.weekdayNormalHours || 0);
  const weekdayNightHours = Math.max(0, hours.weekdayNightHours || 0);
  const holidayNormalHours = Math.max(0, hours.holidayNormalHours || 0);
  const holidayNightHours = Math.max(0, hours.holidayNightHours || 0);

  const weekdayTotalHours = weekdayNormalHours + weekdayNightHours;
  const excessHours = Math.max(0, weekdayTotalHours - OVERTIME_MONTHLY_THRESHOLD_HOURS);
  const excessFromNormal = Math.min(excessHours, weekdayNormalHours);
  const excessFromNight = excessHours - excessFromNormal;

  const weekdayNormalRegularHours = weekdayNormalHours - excessFromNormal;
  const weekdayNightRegularHours = weekdayNightHours - excessFromNight;

  const weekdayPay =
    weekdayNormalRegularHours * OVERTIME_RATES.weekdayNormal +
    excessFromNormal * OVERTIME_RATES.weekdayNormalOver60 +
    weekdayNightRegularHours * OVERTIME_RATES.weekdayNight +
    excessFromNight * OVERTIME_RATES.weekdayNightOver60;

  const holidayPay =
    holidayNormalHours * OVERTIME_RATES.holidayNormal + holidayNightHours * OVERTIME_RATES.holidayNight;

  const totalHours = weekdayTotalHours + holidayNormalHours + holidayNightHours;
  const totalAllowance = Math.floor(hourlyWage * (weekdayPay + holidayPay));

  return {
    hourlyWage: Math.floor(hourlyWage),
    totalHours,
    excessHours,
    totalAllowance,
  };
}

/**
 * @param {Object} input
 * @param {string} input.tableKey 俸給表の種類（"administrative_1" など）
 * @param {number} input.grade 職務の級（flat型の俸給表では無視される）
 * @param {number} input.step 号俸
 * @param {number} input.regionalRate 地域手当率 (0〜0.2)
 * @param {boolean} input.hasSpouse 配偶者の有無
 * @param {number} input.childCount 扶養する子の数
 * @param {number} input.parentCount 扶養する父母等の数
 * @param {string} input.fiscalYear "r6" | "r7" | "r8"
 * @param {string} input.housingType "rent" | "owned" | "none"
 * @param {number} input.rent 家賃(円)
 * @param {string} input.commuteType "transit" | "vehicle" | "none"
 * @param {number} input.commuteFare 公共交通機関の月額運賃相当額(円)
 * @param {number} input.commuteKm 自動車等利用時の片道距離(km)
 * @param {number} input.bonusMonths 期末・勤勉手当の年間支給月数
 * @param {number} input.weekdayNormalHours 平日の時間外勤務時間（深夜を除く月間合計）
 * @param {number} input.weekdayNightHours 平日の時間外勤務時間のうち深夜（22時〜翌5時）
 * @param {number} input.holidayNormalHours 休日勤務時間（深夜を除く月間合計）
 * @param {number} input.holidayNightHours 休日勤務時間のうち深夜（22時〜翌5時）
 */
function calculateSalary(input) {
  const baseSalary = getSalaryAmount(input.tableKey, input.grade, input.step);
  const regionalAllowance = Math.floor(baseSalary * input.regionalRate);

  const dep = DEPENDENT_ALLOWANCE_SCHEDULE[input.fiscalYear] || DEPENDENT_ALLOWANCE_SCHEDULE.r8;
  const dependentAllowance =
    (input.hasSpouse ? dep.spouse : 0) +
    dep.child * Math.max(0, input.childCount || 0) +
    dep.parent * Math.max(0, input.parentCount || 0);

  const housingAllowance =
    input.housingType === "rent" ? calcHousingAllowance(input.rent || 0) : 0;

  let commuteAllowance = 0;
  if (input.commuteType === "transit") {
    commuteAllowance = Math.min(input.commuteFare || 0, COMMUTE_TRANSIT_CAP);
  } else if (input.commuteType === "vehicle") {
    commuteAllowance = calcVehicleCommuteAllowance(input.commuteKm || 0);
  }

  // 超過勤務手当の算定基礎額（俸給月額＋地域手当＋扶養手当）
  const overtimeBase = baseSalary + regionalAllowance + dependentAllowance;
  const hourlyWage = calcHourlyWage(overtimeBase);
  const overtime = calculateOvertimeAllowance(hourlyWage, {
    weekdayNormalHours: input.weekdayNormalHours,
    weekdayNightHours: input.weekdayNightHours,
    holidayNormalHours: input.holidayNormalHours,
    holidayNightHours: input.holidayNightHours,
  });

  const monthlyTotal =
    baseSalary + regionalAllowance + dependentAllowance + housingAllowance + commuteAllowance;
  const monthlyTotalWithOvertime = monthlyTotal + overtime.totalAllowance;

  // 期末・勤勉手当の算定基礎額は簡略化し「俸給+地域手当」とする（実際は扶養手当等も一部算入）。超過勤務手当は含まない。
  const bonusBase = baseSalary + regionalAllowance;
  const bonusMonths = input.bonusMonths || 0;
  const bonusAnnual = Math.floor(bonusBase * bonusMonths);
  const bonusPerOccasion = Math.floor(bonusAnnual / 2);

  // 年収概算は「毎月同じ超過勤務時間が続く」と仮定した概算値
  const annualIncome = monthlyTotalWithOvertime * 12 + bonusAnnual;

  return {
    baseSalary,
    regionalAllowance,
    dependentAllowance,
    housingAllowance,
    commuteAllowance,
    overtimeHourlyWage: overtime.hourlyWage,
    overtimeHours: overtime.totalHours,
    overtimeExcessHours: overtime.excessHours,
    overtimeAllowance: overtime.totalAllowance,
    monthlyTotal,
    monthlyTotalWithOvertime,
    bonusBase,
    bonusAnnual,
    bonusPerOccasion,
    annualIncome,
  };
}

/**
 * 在職期間別割合（期間率）を反映した1回分の期末・勤勉手当を計算する。
 * 新規採用者のように基準期間（6か月）の一部しか在職していない場合の初回賞与などに使う。
 *
 * @param {number} bonusBase 算定基礎額（俸給月額+地域手当）
 * @param {number} bonusMonths 年間支給月数（6月期・12月期の合計）
 * @param {number} periodRate 在職期間別割合（1.0 / 0.8 / 0.6 / 0.3 など）
 */
function calculateBonusWithPeriodRate(bonusBase, bonusMonths, periodRate) {
  const monthsPerOccasion = (bonusMonths || 0) / 2;
  return Math.floor(bonusBase * monthsPerOccasion * (periodRate == null ? 1 : periodRate));
}
