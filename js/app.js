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
  } else {
    note.textContent = "";
  }
}

function currentMeritRate(period) {
  const staffType = document.getElementById(`merit-staff-type-${period}`).value;
  const gradeKey = document.getElementById(`merit-grade-${period}`).value;
  const category = MERIT_RATE_CATEGORIES[staffType];
  const grade = category && category.grades.find((g) => g.key === gradeKey);
  return grade && grade.rate != null ? grade.rate : 1;
}

// 管理職（特定管理職員・指定職職員）は超過勤務手当の支給対象外のため、時間を0として扱う。
function isOvertimeExempt() {
  return document.getElementById("current-staff-type").value !== "general";
}

function readInput() {
  const overtimeExempt = isOvertimeExempt();
  return {
    ...readCommonInput(),
    teishuMonths: Number(document.getElementById("teishu-months").value),
    meritRateJune: currentMeritRate("june"),
    meritRateDecember: currentMeritRate("december"),
    // 超過勤務時間は1時間単位で扱う（小数で入力されても四捨五入する）
    weekdayNormalHours: overtimeExempt ? 0 : Math.round(Number(document.getElementById("ot-weekday-normal").value)),
    weekdayNightHours: overtimeExempt ? 0 : Math.round(Number(document.getElementById("ot-weekday-night").value)),
    holidayNormalHours: overtimeExempt ? 0 : Math.round(Number(document.getElementById("ot-holiday-normal").value)),
    holidayNightHours: overtimeExempt ? 0 : Math.round(Number(document.getElementById("ot-holiday-night").value)),
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
  document.getElementById("r-annual-hero").textContent = yen.format(result.annualIncome);
  document.getElementById("r-annual-floating").textContent = yen.format(result.annualIncome);
  document.getElementById("ot-warning").hidden = result.overtimeExcessHours <= 0;
}

function populateCurrentStaffTypeOptions() {
  const select = document.getElementById("current-staff-type");
  select.innerHTML = "";
  Object.entries(MERIT_RATE_CATEGORIES).forEach(([key, category]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = category.label;
    select.appendChild(opt);
  });
  select.value = "general";
}

function updateOvertimeVisibility() {
  const exempt = isOvertimeExempt();
  document.getElementById("ot-hours-fields").hidden = exempt;
  document.getElementById("ot-management-note").hidden = !exempt;
}

function populateMeritStaffTypeOptions(period) {
  const select = document.getElementById(`merit-staff-type-${period}`);
  select.innerHTML = "";
  Object.entries(MERIT_RATE_CATEGORIES).forEach(([key, category]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = category.label;
    select.appendChild(opt);
  });
  select.value = "general";
}

function populateMeritGradeOptions(period) {
  const select = document.getElementById(`merit-grade-${period}`);
  const staffType = document.getElementById(`merit-staff-type-${period}`).value;
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
  updateOvertimeVisibility();
  const input = readInput();
  const result = calculateSalary(input);
  renderResult(result);
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
}

function initForm() {
  const saved = loadFormState("index");
  const form = document.getElementById("calc-form");

  populateVintageOptions();
  populateSalaryTableOptions(saved && saved["salary-table"]);
  populateGradeOptions(saved && saved.grade);
  populateStepOptions();
  populateRegionalRateOptions();
  populateRegionalRateRegionOptions();
  populateRegionalRateTable();
  populateCurrentStaffTypeOptions();
  ["june", "december"].forEach((period) => {
    populateMeritStaffTypeOptions(period);
    const savedStaffType = saved && saved[`merit-staff-type-${period}`];
    if (savedStaffType) {
      const staffTypeSelect = document.getElementById(`merit-staff-type-${period}`);
      if (Array.from(staffTypeSelect.options).some((o) => o.value === savedStaffType)) {
        staffTypeSelect.value = savedStaffType;
      }
    }
    populateMeritGradeOptions(period);
  });
  updateVisibility();
  applySavedFormValues(form, saved);
  populateStepOptions(); // 復元した俸給表・級に対して号俸を範囲内にクランプし直す
  updateVisibility(); // 復元したhousing-eligible等の値を反映し直す
  updateOvertimeVisibility(); // 復元したcurrent-staff-typeの値を反映し直す
  updateHonshoAmountHint();
  updateHousingAmountHint();
  wireCounterButtons(form);

  wireCommonFormEvents(form, {
    onInputExtra: (e) => {
      if (e.target.id === "merit-staff-type-june") populateMeritGradeOptions("june");
      if (e.target.id === "merit-staff-type-december") populateMeritGradeOptions("december");
    },
    onChangeExtra: handleVintageChange,
    onRecalculate: recalculate,
  });

  document.querySelectorAll(".step-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const stepInput = document.getElementById("step");
      const maxStep = getMaxStep(currentTableKey(), document.getElementById("grade").value);
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

  recalculate();
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadVintages();
  const initialVintage = getVintage(CURRENT_VINTAGE_KEY);
  await loadOfficialSalaryTable(initialVintage && initialVintage.file);
  updateTableSourceNote();
  initForm();
});
