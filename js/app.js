/**
 * app.js
 * index.html 固有のDOM配線。共通のフォーム制御・表示ロジックは js/form-controls.js を使う。
 */

function populateVintageOptions() {
  const select = document.getElementById("salary-vintage");
  select.innerHTML = "";
  SALARY_VINTAGES.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.key;
    opt.textContent = v.available ? v.label : `${v.label} ※選択不可`;
    opt.disabled = !v.available;
    select.appendChild(opt);
  });
  select.value = CURRENT_VINTAGE_KEY;
  updateVintageNote();
}

function updateVintageNote() {
  const note = document.getElementById("vintage-note");
  const vintage = getVintage(CURRENT_VINTAGE_KEY);
  if (vintage && !vintage.available) {
    note.textContent = "このバージョンのデータはまだ登録されていません。現行の俸給表で計算しています。";
  } else if (vintage && vintage.effectiveDate) {
    note.textContent = `${vintage.effectiveDate} 施行の俸給表を使用しています。`;
  } else {
    note.textContent = "";
  }
}

function currentMeritRate() {
  const staffType = document.getElementById("merit-staff-type").value;
  const gradeKey = document.getElementById("merit-grade").value;
  const category = MERIT_RATE_CATEGORIES[staffType];
  const grade = category && category.grades.find((g) => g.key === gradeKey);
  return grade && grade.rate != null ? grade.rate : 1;
}

function readInput() {
  return {
    ...readCommonInput(),
    teishuMonths: Number(document.getElementById("teishu-months").value),
    kinbenMonths: Number(document.getElementById("kinben-months").value),
    meritRate: currentMeritRate(),
    weekdayNormalHours: Number(document.getElementById("ot-weekday-normal").value),
    weekdayNightHours: Number(document.getElementById("ot-weekday-night").value),
    holidayNormalHours: Number(document.getElementById("ot-holiday-normal").value),
    holidayNightHours: Number(document.getElementById("ot-holiday-night").value),
  };
}

function renderResult(result) {
  renderCommonResult(result);
  document.getElementById("r-ot-hourly").textContent = `${yen.format(result.overtimeHourlyWage)} /時間`;
  document.getElementById("r-ot-allowance").textContent = yen.format(result.overtimeAllowance);
  document.getElementById("r-monthly-total-ot").textContent = yen.format(result.monthlyTotalWithOvertime);
  document.getElementById("r-teishu-june").textContent = yen.format(result.teishuJune);
  document.getElementById("r-kinben-june").textContent = yen.format(result.kinbenJune);
  document.getElementById("r-teishu-december").textContent = yen.format(result.teishuDecember);
  document.getElementById("r-kinben-december").textContent = yen.format(result.kinbenDecember);
  document.getElementById("r-bonus-annual").textContent = yen.format(result.bonusAnnual);
  document.getElementById("r-annual").textContent = yen.format(result.annualIncome);
  document.getElementById("ot-warning").hidden = result.overtimeExcessHours <= 0;
}

function populateMeritStaffTypeOptions() {
  const select = document.getElementById("merit-staff-type");
  select.innerHTML = "";
  Object.entries(MERIT_RATE_CATEGORIES).forEach(([key, category]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = category.label;
    select.appendChild(opt);
  });
  select.value = "general";
}

function populateMeritGradeOptions() {
  const select = document.getElementById("merit-grade");
  const staffType = document.getElementById("merit-staff-type").value;
  const category = MERIT_RATE_CATEGORIES[staffType];
  select.innerHTML = "";
  category.grades
    .filter((g) => g.rate != null)
    .forEach((g) => {
      const opt = document.createElement("option");
      opt.value = g.key;
      opt.textContent = g.label;
      select.appendChild(opt);
    });
  select.value = "good";
}

function recalculate() {
  saveFormState("index", document.getElementById("calc-form"));
  const input = readInput();
  const result = calculateSalary(input);
  renderResult(result);
  refreshLifetimeIncomes();
}

// ---------------------------------------------------------------------------
// 生涯賃金シミュレーション
// ---------------------------------------------------------------------------

// 各行の状態（級・号俸・地域手当率）。空配列のときは未生成。
let lifetimeState = [];

function computeLifetimeRowIncome(row) {
  const baseInput = readInput();
  const isGraded = currentTableType() === "graded";
  const result = calculateSalary({
    ...baseInput,
    grade: isGraded ? row.grade : baseInput.grade,
    step: row.step,
    regionalRate: row.regionalRate,
  });
  return result.annualIncome;
}

function renderLifetimeTable() {
  const tbody = document.getElementById("lifetime-tbody");
  tbody.innerHTML = "";

  if (lifetimeState.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="lifetime-empty">「自動生成する」を押すとシミュレーションが始まります。</td></tr>';
    return;
  }

  const isGraded = currentTableType() === "graded";
  const gradeOptions = isGraded
    ? Object.keys(getTable(currentTableKey()).grades)
        .map(Number)
        .sort((a, b) => a - b)
    : [];

  lifetimeState.forEach((row, index) => {
    const tr = document.createElement("tr");

    const yearTd = document.createElement("td");
    yearTd.textContent = `${index + 1}年目`;
    tr.appendChild(yearTd);

    const gradeTd = document.createElement("td");
    if (isGraded) {
      const gradeSelect = document.createElement("select");
      gradeSelect.dataset.row = index;
      gradeSelect.dataset.field = "grade";
      gradeOptions.forEach((g) => {
        const opt = document.createElement("option");
        opt.value = g;
        opt.textContent = `${g}級`;
        if (g === row.grade) opt.selected = true;
        gradeSelect.appendChild(opt);
      });
      gradeTd.appendChild(gradeSelect);
    } else {
      gradeTd.textContent = "-";
    }
    tr.appendChild(gradeTd);

    const stepTd = document.createElement("td");
    const stepInput = document.createElement("input");
    stepInput.type = "number";
    stepInput.min = "1";
    stepInput.max = String(getMaxStep(currentTableKey(), row.grade));
    stepInput.value = row.step;
    stepInput.dataset.row = index;
    stepInput.dataset.field = "step";
    stepTd.appendChild(stepInput);
    tr.appendChild(stepTd);

    const regionTd = document.createElement("td");
    const regionSelect = document.createElement("select");
    regionSelect.dataset.row = index;
    regionSelect.dataset.field = "regionalRate";
    REGIONAL_ALLOWANCE_RATES.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.value;
      opt.textContent = r.name;
      if (r.value === row.regionalRate) opt.selected = true;
      regionSelect.appendChild(opt);
    });
    regionTd.appendChild(regionSelect);
    tr.appendChild(regionTd);

    const incomeTd = document.createElement("td");
    incomeTd.className = "lifetime-income";
    incomeTd.id = `lifetime-income-${index}`;
    tr.appendChild(incomeTd);

    tbody.appendChild(tr);
  });
}

function refreshLifetimeIncomes() {
  if (lifetimeState.length === 0) {
    document.getElementById("lifetime-total").textContent = "-";
    document.getElementById("lifetime-average").textContent = "-";
    document.getElementById("lifetime-final").textContent = "-";
    return;
  }

  let total = 0;
  lifetimeState.forEach((row, index) => {
    const income = computeLifetimeRowIncome(row);
    total += income;
    const cell = document.getElementById(`lifetime-income-${index}`);
    if (cell) cell.textContent = yen.format(income);
  });

  document.getElementById("lifetime-total").textContent = yen.format(total);
  document.getElementById("lifetime-average").textContent = yen.format(Math.round(total / lifetimeState.length));
  document.getElementById("lifetime-final").textContent = yen.format(
    computeLifetimeRowIncome(lifetimeState[lifetimeState.length - 1])
  );
}

function autofillLifetime() {
  const years = Math.min(Math.max(Number(document.getElementById("lifetime-years").value) || 1, 1), 35);
  const startStep = Math.max(Number(document.getElementById("lifetime-start-step").value) || 1, 1);
  const increment = Number(document.getElementById("lifetime-increment").value);
  const tableKey = currentTableKey();
  const isGraded = currentTableType() === "graded";
  const baseGrade = isGraded ? Number(document.getElementById("grade").value) : null;
  const baseRegionalRate = Number(document.getElementById("regional-rate").value);

  const newState = [];
  for (let i = 0; i < years; i++) {
    const prev = newState[i - 1];
    const grade = prev ? prev.grade : baseGrade;
    const maxStep = getMaxStep(tableKey, grade);
    const step = prev ? Math.min(prev.step + increment, maxStep) : Math.min(startStep, maxStep);
    const regionalRate = prev ? prev.regionalRate : baseRegionalRate;
    newState.push({ grade, step, regionalRate });
  }

  lifetimeState = newState;
  renderLifetimeTable();
  refreshLifetimeIncomes();
}

function resetLifetimeSimulation() {
  lifetimeState = []; // 俸給表・バージョンが変わると級構成が変わるためリセット
  renderLifetimeTable();
}

function initLifetimeSimulator() {
  document.getElementById("lifetime-autofill").addEventListener("click", autofillLifetime);

  document.getElementById("lifetime-tbody").addEventListener("change", (e) => {
    const rowIndex = Number(e.target.dataset.row);
    const field = e.target.dataset.field;
    if (Number.isNaN(rowIndex) || !field) return;

    const row = lifetimeState[rowIndex];
    if (field === "grade") {
      row.grade = Number(e.target.value);
      const maxStep = getMaxStep(currentTableKey(), row.grade);
      row.step = Math.min(row.step, maxStep);
      renderLifetimeTable();
    } else if (field === "step") {
      const maxStep = getMaxStep(currentTableKey(), row.grade);
      row.step = Math.min(Math.max(Number(e.target.value) || 1, 1), maxStep);
      e.target.value = row.step;
    } else if (field === "regionalRate") {
      row.regionalRate = Number(e.target.value);
    }
    refreshLifetimeIncomes();
  });
}

// ---------------------------------------------------------------------------
// 初期化
// ---------------------------------------------------------------------------

async function handleVintageChange(e) {
  if (e.target.id !== "salary-vintage") return;
  const selectedKey = e.target.value;
  const switched = await switchVintage(selectedKey);
  if (!switched) {
    e.target.value = CURRENT_VINTAGE_KEY; // 未登録バージョンは選べないので元に戻す
  }
  updateVintageNote();
  updateTableSourceNote();
  populateSalaryTableOptions();
  populateGradeOptions();
  populateStepOptions();
  updateVisibility();
  resetLifetimeSimulation();
}

function initForm() {
  const saved = loadFormState("index");
  const form = document.getElementById("calc-form");

  populateVintageOptions();
  populateSalaryTableOptions(saved && saved["salary-table"]);
  populateGradeOptions(saved && saved.grade);
  populateStepOptions();
  populateRegionalRateOptions();
  populateRegionalRateTable();
  populateMeritStaffTypeOptions();
  if (saved && saved["merit-staff-type"]) {
    const staffTypeSelect = document.getElementById("merit-staff-type");
    if (Array.from(staffTypeSelect.options).some((o) => o.value === saved["merit-staff-type"])) {
      staffTypeSelect.value = saved["merit-staff-type"];
    }
  }
  populateMeritGradeOptions();
  updateVisibility();
  applySavedFormValues(form, saved);
  populateStepOptions(); // 復元した俸給表・級に対して号俸を範囲内にクランプし直す

  wireCommonFormEvents(form, {
    onInputExtra: (e) => {
      if (e.target.id === "salary-table") resetLifetimeSimulation();
      if (e.target.id === "merit-staff-type") populateMeritGradeOptions();
    },
    onChangeExtra: handleVintageChange,
    onRecalculate: recalculate,
  });

  document.querySelectorAll(".step-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const stepInput = document.getElementById("step");
      const maxStep = Number(stepInput.max) || 1;
      const delta = Number(btn.dataset.delta);
      const next = Math.min(Math.max((Number(stepInput.value) || 1) + delta, 1), maxStep);
      stepInput.value = next;
      recalculate();
    });
  });

  document.getElementById("reset-saved-input").addEventListener("click", () => {
    clearFormState("index");
    location.reload();
  });

  initLifetimeSimulator();
  recalculate();
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadVintages();
  const initialVintage = getVintage(CURRENT_VINTAGE_KEY);
  await loadOfficialSalaryTable(initialVintage && initialVintage.file);
  updateTableSourceNote();
  initForm();
});
