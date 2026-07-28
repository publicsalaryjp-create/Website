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

  const monthlyTotal =
    baseSalary + regionalAllowance + dependentAllowance + housingAllowance + commuteAllowance;

  // 期末・勤勉手当の算定基礎額は簡略化し「俸給+地域手当」とする（実際は扶養手当等も一部算入）
  const bonusBase = baseSalary + regionalAllowance;
  const bonusMonths = input.bonusMonths || 0;
  const bonusAnnual = Math.floor(bonusBase * bonusMonths);
  const bonusPerOccasion = Math.floor(bonusAnnual / 2);

  const annualIncome = monthlyTotal * 12 + bonusAnnual;

  return {
    baseSalary,
    regionalAllowance,
    dependentAllowance,
    housingAllowance,
    commuteAllowance,
    monthlyTotal,
    bonusBase,
    bonusAnnual,
    bonusPerOccasion,
    annualIncome,
  };
}
