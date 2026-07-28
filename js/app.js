/**
 * app.js
 * フォームの入力を読み取り、calculator.js の関数を呼んで結果を画面に反映する。
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
}

function populateStepOptions() {
  const tableKey = currentTableKey();
  const grade = document.getElementById("grade").value;
  const stepSelect = document.getElementById("step");
  const currentValue = Number(stepSelect.value) || 1;
  const maxStep = getMaxStep(tableKey, grade);
  stepSelect.innerHTML = "";
  for (let s = 1; s <= maxStep; s++) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = `${s}号俸`;
    stepSelect.appendChild(opt);
  }
  stepSelect.value = Math.min(currentValue, maxStep);
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
  };
}

function renderResult(result) {
  document.getElementById("r-base").textContent = yen.format(result.baseSalary);
  document.getElementById("r-regional").textContent = yen.format(result.regionalAllowance);
  document.getElementById("r-dependent").textContent = yen.format(result.dependentAllowance);
  document.getElementById("r-housing").textContent = yen.format(result.housingAllowance);
  document.getElementById("r-commute").textContent = yen.format(result.commuteAllowance);
  document.getElementById("r-monthly-total").textContent = yen.format(result.monthlyTotal);
  document.getElementById("r-bonus-once").textContent = yen.format(result.bonusPerOccasion);
  document.getElementById("r-bonus-annual").textContent = yen.format(result.bonusAnnual);
  document.getElementById("r-annual").textContent = yen.format(result.annualIncome);
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
  renderResult(result);
}

function updateTableSourceNote() {
  const note = document.getElementById("table-source-note");
  if (SALARY_CATALOG_IS_OFFICIAL) {
    note.innerHTML = `俸給表は<strong>提供データ（${getTableKeys().length}表）</strong>を使用しています。${
      SALARY_CATALOG_SOURCE_NOTE ? ` ${SALARY_CATALOG_SOURCE_NOTE}` : ""
    }`;
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
  form.addEventListener("change", recalculate);

  recalculate();
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadOfficialSalaryTable();
  updateTableSourceNote();
  initForm();
});
