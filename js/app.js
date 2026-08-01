/**
 * app.js
 * index.html 固有のDOM配線。共通のフォーム制御・表示ロジックは js/form-controls.js を使う。
 */

function populateVintageOptions() {
  const group = document.getElementById("salary-vintage-group");
  group.innerHTML = "";
  SALARY_VINTAGES.forEach((v) => {
    const label = document.createElement("label");
    label.className = "radio-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "salary-vintage";
    input.id = `salary-vintage-${v.key}`;
    input.value = v.key;
    input.disabled = !v.available;
    input.checked = v.key === CURRENT_VINTAGE_KEY;
    label.appendChild(input);
    label.appendChild(document.createTextNode(v.label));
    group.appendChild(label);
  });
  updateVintageNote();
}

function updateVintageNote() {
  const note = document.getElementById("vintage-note");
  const vintage = getVintage(CURRENT_VINTAGE_KEY);
  if (vintage && !vintage.available) {
    note.textContent = "このバージョンのデータはまだ登録されていません。現行の俸給表で計算しています。";
  } else if (vintage && vintage.note) {
    note.textContent = vintage.note;
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
// 指定職俸給表を適用している場合は職員区分の選択にかかわらず常に対象外とする。
function isOvertimeExempt() {
  return currentTableKey() === "designated" || document.getElementById("current-staff-type").value !== "general";
}

function readInput() {
  const overtimeExempt = isOvertimeExempt();
  return {
    ...readCommonInput(),
    teishuMonths: TEISHU_MONTHS,
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

// 指定職俸給表を選んでいる場合は勤勉手当の職員区分も「指定職職員」で固定し、選択させない。
// それ以外（行政職俸給表(一)）の場合は指定職職員を選ばせない（一般職員・特定管理職員のみ）。
function populateMeritStaffTypeOptions(period) {
  const select = document.getElementById(`merit-staff-type-${period}`);
  const isDesignatedTable = currentTableKey() === "designated";
  select.innerHTML = "";
  Object.entries(MERIT_RATE_CATEGORIES).forEach(([key, category]) => {
    if (isDesignatedTable !== (key === "designated")) return;
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = category.label;
    select.appendChild(opt);
  });
  select.value = isDesignatedTable ? "designated" : "general";
}

function updateMeritStaffTypeVisibility() {
  const hide = currentTableKey() === "designated";
  document.getElementById("merit-staff-type-field-june").hidden = hide;
  document.getElementById("merit-staff-type-field-december").hidden = hide;
}

/**
 * 勤務成績区分のlabel（例:「特に優秀（125.25/100以上、下限採用）」）を
 * 段階名と成績率の詳細に分割する。プルダウンには段階名のみを表示し、
 * 詳細は選択欄の下のヒントテキストに表示する（updateMeritGradeNote参照）。
 */
function splitGradeLabel(label) {
  const idx = label.indexOf("（");
  if (idx === -1) return { name: label, detail: "" };
  return {
    name: label.slice(0, idx),
    detail: label.slice(idx + 1).replace(/）$/, ""),
  };
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
      opt.textContent = splitGradeLabel(g.label).name;
      select.appendChild(opt);
    });
  select.value = "good";
  updateMeritGradeNote(period);
}

/** 現在選択中の勤務成績区分の成績率の詳細を、選択欄の下のヒントテキストに表示する */
function updateMeritGradeNote(period) {
  const note = document.getElementById(`merit-grade-${period}-note`);
  if (!note) return;
  const staffType = document.getElementById(`merit-staff-type-${period}`).value;
  const gradeKey = document.getElementById(`merit-grade-${period}`).value;
  const category = MERIT_RATE_CATEGORIES[staffType];
  const grade = category && category.grades.find((g) => g.key === gradeKey);
  note.textContent = grade ? splitGradeLabel(grade.label).detail : "";
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
  if (e.target.name !== "salary-vintage") return;
  const selectedKey = e.target.value;
  const switched = await switchVintage(selectedKey);
  if (!switched) {
    // 未登録バージョンは選べないので元に戻す
    const original = document.getElementById(`salary-vintage-${CURRENT_VINTAGE_KEY}`);
    if (original) original.checked = true;
  }
  updateVintageNote();
  updateTableSourceNote();
  populateSalaryTableOptions();
  populateGradeOptions();
  populateStepOptions();
  updateVisibility();
  ["june", "december"].forEach((period) => {
    populateMeritStaffTypeOptions(period);
    populateMeritGradeOptions(period);
  });
  updateMeritStaffTypeVisibility();
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
  ["child-under15-count", "child-16to22-count", "parent-count"].forEach(populateDependentCountOptions);
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
  updateMeritStaffTypeVisibility();
  applySavedFormValues(form, saved);
  populateStepOptions(); // 復元した俸給表・級に対して号俸を範囲内にクランプし直す
  updateVisibility(); // 復元したhousing-eligible等の値を反映し直す
  updateOvertimeVisibility(); // 復元したcurrent-staff-typeの値を反映し直す
  updateHonshoAmountHint();
  updateHousingAmountHint();
  updateMeritGradeNote("june"); // 復元した勤務成績区分の値を反映し直す
  updateMeritGradeNote("december");
  wireCounterButtons(form);
  initHintToggles();

  wireCommonFormEvents(form, {
    onInputExtra: (e) => {
      if (e.target.id === "salary-table") {
        ["june", "december"].forEach((period) => {
          populateMeritStaffTypeOptions(period);
          populateMeritGradeOptions(period);
        });
        updateMeritStaffTypeVisibility();
      }
      if (e.target.id === "merit-staff-type-june") populateMeritGradeOptions("june");
      if (e.target.id === "merit-staff-type-december") populateMeritGradeOptions("december");
      if (e.target.id === "merit-grade-june") updateMeritGradeNote("june");
      if (e.target.id === "merit-grade-december") updateMeritGradeNote("december");
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

  initFloatingResultObserver();
  recalculate();
}

/**
 * スマホ版フローティング表示（年収概算）と、計算結果パネル内の実際の年収概算（.result-hero）が
 * 画面上で重複しないよう、実物が画面内に入っている間はフローティング側を隠す。
 */
function initFloatingResultObserver() {
  const floating = document.getElementById("mobile-floating-result");
  const target = document.querySelector(".result-hero");
  if (!floating || !target || !("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        floating.hidden = entry.isIntersecting;
      });
    },
    { threshold: 0 }
  );
  observer.observe(target);
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadVintages();
  const initialVintage = getVintage(CURRENT_VINTAGE_KEY);
  await loadOfficialSalaryTable(initialVintage && initialVintage.file);
  updateTableSourceNote();
  initForm();
});
