/**
 * form-controls.js
 * index.html / new-hire.html の両方で使う共通のフォーム制御・表示ロジック。
 * 両ページで一致しているDOM ID（salary-table, grade, grade-field, step, step-max,
 * regional-rate, child-under15-count, child-16to22-count, parent-count,
 * housing-type, rent-field, commute-type, commute-fare-field, commute-km-field,
 * table-source-note, r-base, r-regional, r-dependent, r-housing, r-commute,
 * r-monthly-total）を前提にする。
 * ページ固有の項目（超過勤務・生涯賃金・新規採用者の賞与期間率など）は
 * それぞれ js/app.js / js/new-hire.js 側で扱う。
 */

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });

function currentTableKey() {
  return document.getElementById("salary-table").value;
}

function currentTableType() {
  const table = getTable(currentTableKey());
  return table ? table.type : "graded";
}

function populateSalaryTableOptions(defaultKey) {
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
  if (defaultKey && getTableKeys().includes(defaultKey)) {
    select.value = defaultKey;
  }
}

function populateGradeOptions(defaultGrade) {
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
  if (defaultGrade != null && gradeSelect.querySelector(`option[value="${defaultGrade}"]`)) {
    gradeSelect.value = String(defaultGrade);
  }
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

function updateVisibility() {
  document.getElementById("grade-field").hidden = currentTableType() !== "graded";

  const housingType = document.getElementById("housing-type").value;
  document.getElementById("rent-field").hidden = housingType !== "rent";

  const commuteType = document.getElementById("commute-type").value;
  document.getElementById("commute-fare-field").hidden = commuteType !== "transit";
  document.getElementById("commute-km-field").hidden = commuteType !== "vehicle";
}

/** 両ページ共通の入力項目（超過勤務時間・新規採用者の期間率などページ固有の項目は含まない） */
function readCommonInput() {
  return {
    tableKey: currentTableKey(),
    grade: Number(document.getElementById("grade").value),
    step: Number(document.getElementById("step").value),
    regionalRate: Number(document.getElementById("regional-rate").value),
    childUnder15Count: Number(document.getElementById("child-under15-count").value),
    child16to22Count: Number(document.getElementById("child-16to22-count").value),
    parentCount: Number(document.getElementById("parent-count").value),
    housingType: document.getElementById("housing-type").value,
    rent: Number(document.getElementById("rent").value),
    commuteType: document.getElementById("commute-type").value,
    commuteFare: Number(document.getElementById("commute-fare").value),
    commuteKm: Number(document.getElementById("commute-km").value),
    bonusMonths: Number(document.getElementById("bonus-months").value),
  };
}

/** calculateSalary() の結果のうち両ページ共通で表示する項目（俸給〜月額支給額合計）を描画する */
function renderCommonResult(result) {
  document.getElementById("r-base").textContent = yen.format(result.baseSalary);
  document.getElementById("r-regional").textContent = yen.format(result.regionalAllowance);
  document.getElementById("r-dependent").textContent = yen.format(result.dependentAllowance);
  document.getElementById("r-housing").textContent = yen.format(result.housingAllowance);
  document.getElementById("r-commute").textContent = yen.format(result.commuteAllowance);
  document.getElementById("r-monthly-total").textContent = yen.format(result.monthlyTotal);
}

/** 俸給表データが公式データか参考値かを画面上部に表示する */
function updateTableSourceNote() {
  const note = document.getElementById("table-source-note");
  if (SALARY_CATALOG_IS_OFFICIAL) {
    const date = SALARY_CATALOG.effectiveDate ? `（${SALARY_CATALOG.effectiveDate}時点）` : "";
    note.innerHTML = `俸給表は<strong>提供データ（${getTableKeys().length}表${date}）</strong>を使用しています。${
      SALARY_CATALOG_SOURCE_NOTE ? ` ${SALARY_CATALOG_SOURCE_NOTE}` : ""
    }`;
  } else {
    note.innerHTML =
      "俸給表データの読み込みに失敗したため、行政職俸給表(一)相当の<strong>参考値（要確認）</strong>で計算しています。";
  }
}

/**
 * 「俸給表を変えたら級・号俸を再構成する」「住居形態/通勤手段を変えたら表示を切り替える」
 * 「号俸の入力値を号俸数の範囲にクランプする」という両ページ共通のイベント配線を行う。
 * ページ固有の追加処理は onInputExtra / onChangeExtra（両方とも async 対応）で行う。
 *
 * @param {HTMLFormElement} form
 * @param {Object} handlers
 * @param {(e: Event) => void|Promise<void>} [handlers.onInputExtra]
 * @param {(e: Event) => void|Promise<void>} [handlers.onChangeExtra]
 * @param {() => void} handlers.onRecalculate
 */
function wireCommonFormEvents(form, { onInputExtra, onChangeExtra, onRecalculate }) {
  form.addEventListener("input", async (e) => {
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
    if (onInputExtra) await onInputExtra(e);
    onRecalculate();
  });

  form.addEventListener("change", async (e) => {
    if (e.target.id === "step") {
      const stepInput = document.getElementById("step");
      const maxStep = Number(stepInput.max) || 1;
      stepInput.value = Math.min(Math.max(Number(stepInput.value) || 1, 1), maxStep);
    }
    if (onChangeExtra) await onChangeExtra(e);
    onRecalculate();
  });
}
