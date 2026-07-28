/**
 * new-hire.js
 * 新規採用職員向けページ（new-hire.html）のDOM配線。
 * data.js / calculator.js を index.html と共有する。
 */

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });

function currentTableKey() {
  return document.getElementById("salary-table").value;
}

function currentTableType() {
  const table = getTable(currentTableKey());
  return table ? table.type : "graded";
}

function populateSalaryTableOptions() {
  const select = document.getElementById("salary-table");
  select.innerHTML = "";
  getTableKeys().forEach((key) => {
    const table = getTable(key);
    if (!table) return;
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = table.label;
    select.appendChild(opt);
  });
  if (getTableKeys().includes("administrative_1")) {
    select.value = "administrative_1";
  }
}

function populateGradeOptions() {
  const gradeSelect = document.getElementById("grade");
  const table = getTable(currentTableKey());
  gradeSelect.innerHTML = "";
  if (!table || table.type !== "graded") return;
  Object.keys(table.grades)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach((grade) => {
      const opt = document.createElement("option");
      opt.value = grade;
      opt.textContent = `${grade}級`;
      gradeSelect.appendChild(opt);
    });
  gradeSelect.value = "1";
}

function populateStepOptions() {
  const tableKey = currentTableKey();
  const grade = document.getElementById("grade").value;
  const stepInput = document.getElementById("step");
  const currentValue = Number(stepInput.value) || 1;
  const maxStep = getMaxStep(tableKey, grade);
  stepInput.max = maxStep;
  stepInput.value = Math.min(Math.max(currentValue, 1), maxStep);
  document.getElementById("step-max").textContent = `/ ${maxStep}号俸`;
}

function populateRegionalRateOptions() {
  const select = document.getElementById("regional-rate");
  select.innerHTML = "";
  REGIONAL_ALLOWANCE_RATES.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r.value;
    opt.textContent = r.label;
    select.appendChild(opt);
  });
}

function populateFiscalYearOptions() {
  const select = document.getElementById("fiscal-year");
  select.innerHTML = "";
  Object.entries(DEPENDENT_ALLOWANCE_SCHEDULE).forEach(([key, v]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = v.label;
    select.appendChild(opt);
  });
  select.value = "r8";
}

function populateBonusRateOptions() {
  ["first-bonus-rate", "second-bonus-rate"].forEach((id) => {
    const select = document.getElementById(id);
    select.innerHTML = "";
    BONUS_PERIOD_RATES.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.value;
      opt.textContent = r.label;
      select.appendChild(opt);
    });
  });
  // 新規採用者の典型例：1回目は在職期間が短い（3か月未満=期間率0.3）、2回目は満額を既定値とする
  document.getElementById("first-bonus-rate").value = "0.3";
  document.getElementById("second-bonus-rate").value = "1";
}

function readInput() {
  return {
    tableKey: currentTableKey(),
    grade: Number(document.getElementById("grade").value),
    step: Number(document.getElementById("step").value),
    regionalRate: Number(document.getElementById("regional-rate").value),
    fiscalYear: document.getElementById("fiscal-year").value,
    hasSpouse: document.getElementById("has-spouse").checked,
    childCount: Number(document.getElementById("child-count").value),
    parentCount: Number(document.getElementById("parent-count").value),
    housingType: document.getElementById("housing-type").value,
    rent: Number(document.getElementById("rent").value),
    commuteType: document.getElementById("commute-type").value,
    commuteFare: Number(document.getElementById("commute-fare").value),
    commuteKm: Number(document.getElementById("commute-km").value),
    bonusMonths: Number(document.getElementById("bonus-months").value),
    weekdayNormalHours: 0,
    weekdayNightHours: 0,
    holidayNormalHours: 0,
    holidayNightHours: 0,
  };
}

function updateVisibility() {
  document.getElementById("grade-field").hidden = currentTableType() !== "graded";

  const housingType = document.getElementById("housing-type").value;
  document.getElementById("rent-field").hidden = housingType !== "rent";

  const commuteType = document.getElementById("commute-type").value;
  document.getElementById("commute-fare-field").hidden = commuteType !== "transit";
  document.getElementById("commute-km-field").hidden = commuteType !== "vehicle";
}

function recalculate() {
  const input = readInput();
  const result = calculateSalary(input);

  const firstRate = Number(document.getElementById("first-bonus-rate").value);
  const secondRate = Number(document.getElementById("second-bonus-rate").value);
  const firstBonus = calculateBonusWithPeriodRate(result.bonusBase, input.bonusMonths, firstRate);
  const secondBonus = calculateBonusWithPeriodRate(result.bonusBase, input.bonusMonths, secondRate);
  const annualIncome = result.monthlyTotal * 12 + firstBonus + secondBonus;

  document.getElementById("r-base").textContent = yen.format(result.baseSalary);
  document.getElementById("r-regional").textContent = yen.format(result.regionalAllowance);
  document.getElementById("r-dependent").textContent = yen.format(result.dependentAllowance);
  document.getElementById("r-housing").textContent = yen.format(result.housingAllowance);
  document.getElementById("r-commute").textContent = yen.format(result.commuteAllowance);
  document.getElementById("r-monthly-total").textContent = yen.format(result.monthlyTotal);
  document.getElementById("r-bonus-first").textContent = yen.format(firstBonus);
  document.getElementById("r-bonus-second").textContent = yen.format(secondBonus);
  document.getElementById("r-annual").textContent = yen.format(annualIncome);
}

function updateTableSourceNote() {
  const note = document.getElementById("table-source-note");
  if (SALARY_CATALOG_IS_OFFICIAL) {
    const date = SALARY_CATALOG.effectiveDate ? `（${SALARY_CATALOG.effectiveDate}時点）` : "";
    note.innerHTML = `俸給表は<strong>提供データ（${getTableKeys().length}表${date}）</strong>を使用しています。`;
  } else {
    note.innerHTML =
      "俸給表データの読み込みに失敗したため、行政職俸給表(一)相当の<strong>参考値（要確認）</strong>で計算しています。";
  }
}

function initForm() {
  populateSalaryTableOptions();
  populateGradeOptions();
  populateStepOptions();
  populateRegionalRateOptions();
  populateFiscalYearOptions();
  populateBonusRateOptions();
  updateVisibility();

  const form = document.getElementById("calc-form");
  form.addEventListener("input", (e) => {
    if (e.target.id === "salary-table") {
      populateGradeOptions();
      populateStepOptions();
      updateVisibility();
    }
    if (e.target.id === "grade") {
      populateStepOptions();
    }
    if (e.target.id === "housing-type" || e.target.id === "commute-type") {
      updateVisibility();
    }
    recalculate();
  });
  form.addEventListener("change", (e) => {
    if (e.target.id === "step") {
      const stepInput = document.getElementById("step");
      const maxStep = Number(stepInput.max) || 1;
      const clamped = Math.min(Math.max(Number(stepInput.value) || 1, 1), maxStep);
      stepInput.value = clamped;
    }
    recalculate();
  });

  recalculate();
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadOfficialSalaryTable();
  updateTableSourceNote();
  initForm();
});
