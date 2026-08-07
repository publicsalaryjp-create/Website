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

// 職員区分は「職員区分」ラジオボタン（一般職員／特定管理職員）で、俸給の特別調整額・
// 期末勤勉手当の両方に共通して使用する。指定職俸給表を選んでいる場合はラジオボタンを
// 表示せず、常に指定職職員の区分を適用する。
function currentMeritStaffTypeKey() {
  if (currentTableKey() === "designated") return "designated";
  const categoryKey = document.getElementById("special-adjustment-category").value;
  return isSpecialAdjustmentManager() && (categoryKey === "type1" || categoryKey === "type2")
    ? "senior_manager"
    : "general";
}

function currentGrade() {
  return Number(document.getElementById("grade").value) || 0;
}

function currentMeritGrade(period) {
  const staffType = currentMeritStaffTypeKey();
  const gradeKey = radioValue(`merit-grade-${period}`);
  const category = MERIT_RATE_CATEGORIES[staffType];
  const grade = category && category.grades.find((g) => g.key === gradeKey);
  // 指定職俸給表8号（事務次官等）は「優秀」の成績率が107.5/100の固定値になる特例。
  // 指定職俸給表は級の概念がないflat型で、号（document.getElementById("step")）が
  // そのまま俸給表steps配列のインデックスに対応するため、grade（職務の級）ではなくstepを見る。
  const designatedStep = Number(document.getElementById("step").value);
  if (grade && staffType === "designated" && gradeKey === "excellent" && designatedStep === 8) {
    return { ...grade, rate: DESIGNATED_STEP8_EXCELLENT_RATE, minRate: DESIGNATED_STEP8_EXCELLENT_RATE, maxRate: DESIGNATED_STEP8_EXCELLENT_RATE };
  }
  return grade;
}

/** 成績率の入力欄（100分率、例: 102.25）の値を、計算で使う倍率（例: 1.0225）に変換する */
function currentMeritRate(period) {
  const input = document.getElementById(`merit-rate-${period}`);
  const value = input ? Number(input.value) : NaN;
  const grade = currentMeritGrade(period);
  if (!grade) return 1;
  if (!Number.isFinite(value)) return grade.rate;
  const rate = value / 100;
  const maxRate = Number.isFinite(grade.maxRate) ? grade.maxRate : Infinity;
  return Math.min(Math.max(rate, grade.minRate), maxRate);
}

// 管理職（俸給の特別調整額の対象・指定職職員）は超過勤務手当の支給対象外のため、時間を0として扱う。
// 指定職俸給表を適用している場合は常に対象外、行政職俸給表(一)等では「特定管理職員」選択時に対象外とする。
function isOvertimeExempt() {
  return currentTableKey() === "designated" || isSpecialAdjustmentManager();
}

function readInput() {
  const overtimeExempt = isOvertimeExempt();
  const terminalRates = ALLOWANCE_RATES.terminalAllowance[currentMeritStaffTypeKey()];
  return {
    ...readCommonInput(),
    teishuMonthsJune: terminalRates["2026-06"],
    teishuMonthsDecember: terminalRates["2026-12"],
    bonusRoleStageAdditionRate: getBonusRoleStageAdditionRate(currentTableKey(), currentGrade()),
    meritRateJune: currentMeritRate("june"),
    meritRateDecember: currentMeritRate("december"),
    // 超過勤務時間は1時間単位で扱う（小数で入力されても四捨五入する）
    weekdayNormalHours: overtimeExempt ? 0 : Math.round(Number(document.getElementById("ot-weekday-normal").value)),
    weekdayNightHours: overtimeExempt ? 0 : Math.round(Number(document.getElementById("ot-weekday-night").value)),
    holidayNormalHours: overtimeExempt ? 0 : Math.round(Number(document.getElementById("ot-holiday-normal").value)),
    holidayNightHours: overtimeExempt ? 0 : Math.round(Number(document.getElementById("ot-holiday-night").value)),
  };
}

function renderTerminalAllowanceRateNote() {
  const staffType = currentMeritStaffTypeKey();
  const terminal = ALLOWANCE_RATES.terminalAllowance[staffType];
  const label = MERIT_RATE_CATEGORIES[staffType].label;
  document.getElementById("terminal-allowance-rate-note").textContent =
    `${label}: 2026年6月期 ${terminal["2026-06"]}月分／2026年12月期 ${terminal["2026-12"]}月分`;
}

/** 平日125%・深夜150%・休日135%・休日深夜160%の各時間単価（月60時間超の割増分は別途注記で案内） */
function renderOvertimeRateHints(overtimeHourlyWage) {
  const rateHints = [
    ["ot-weekday-normal-rate-hint", OVERTIME_RATES.weekdayNormal],
    ["ot-weekday-night-rate-hint", OVERTIME_RATES.weekdayNight],
    ["ot-holiday-normal-rate-hint", OVERTIME_RATES.holidayNormal],
    ["ot-holiday-night-rate-hint", OVERTIME_RATES.holidayNight],
  ];
  rateHints.forEach(([id, rate]) => {
    const hint = document.getElementById(id);
    if (!hint) return;
    const percent = Math.round(rate * 100);
    hint.textContent = `時間単価: ${yen.format(Math.round(overtimeHourlyWage * rate))} /時間（${percent}%）`;
  });
}

function renderResult(result) {
  renderTerminalAllowanceRateNote();
  renderCommonResult(result);
  renderOvertimeRateHints(result.overtimeHourlyWage);
  document.getElementById("r-ot-allowance").textContent = yen.format(result.overtimeAllowance);
  document.getElementById("r-monthly-total-ot").textContent = yen.format(result.monthlyTotalWithOvertime);
  document.getElementById("r-teishu-june").textContent = yen.format(result.teishuJune);
  document.getElementById("r-kinben-june").textContent = yen.format(result.kinbenJune);
  document.getElementById("r-teishu-december").textContent = yen.format(result.teishuDecember);
  document.getElementById("r-kinben-december").textContent = yen.format(result.kinbenDecember);
  document.getElementById("r-bonus-annual").textContent = yen.format(result.bonusAnnual);
  document.getElementById("r-annual").textContent = yen.format(result.annualIncome);
  document.getElementById("r-annual-hero").textContent = yen.format(result.annualIncome);
  syncFloatingResult();
  document.getElementById("ot-warning").hidden = result.overtimeExcessHours <= 0;
}

/** 職務の級で選択可能な俸給の特別調整額の区分（一種〜五種等）をプルダウンに反映する */
function populateSpecialAdjustmentCategoryOptions() {
  const select = document.getElementById("special-adjustment-category");
  const grade = Number(document.getElementById("grade").value);
  const options = getSpecialAdjustmentOptions(currentTableKey(), grade);
  select.innerHTML = "";
  options.forEach((opt) => {
    const el = document.createElement("option");
    el.value = opt.key;
    el.textContent = opt.label;
    select.appendChild(el);
  });
  if (options.length) select.value = options[0].key;
}

/** 選択中の俸給の特別調整額の区分に対応する定額をヒント表示する */
function updateSpecialAdjustmentAmountHint() {
  const hint = document.getElementById("special-adjustment-amount-hint");
  if (!hint) return;
  if (!isSpecialAdjustmentManager()) {
    hint.textContent = "";
    return;
  }
  const grade = Number(document.getElementById("grade").value);
  const categoryKey = document.getElementById("special-adjustment-category").value;
  const amount = getSpecialAdjustmentAmount(currentTableKey(), grade, categoryKey);
  hint.textContent = amount > 0 ? `${grade}級の特別調整額: ${yen.format(amount)}` : "";
}

/**
 * 俸給の特別調整額は対象区分（一種〜五種）が定められている級（行政職俸給表(一)の4〜10級）でのみ
 * 選択できる。対象区分がない級（1〜3級等）や他の俸給表では項目自体を隠し、
 * 「特定管理職員」が選ばれたままにならないよう一般職員に戻す。
 */
function updateSpecialAdjustmentVisibility() {
  const grade = Number(document.getElementById("grade").value);
  const options = getSpecialAdjustmentOptions(currentTableKey(), grade);
  const field = document.getElementById("special-adjustment-field");
  if (field) field.hidden = options.length === 0;

  if (options.length === 0 && isSpecialAdjustmentManager()) {
    const generalRadio = document.getElementById("special-adjustment-type-general");
    if (generalRadio) generalRadio.checked = true;
  }

  const categoryField = document.getElementById("special-adjustment-category-field");
  if (categoryField) categoryField.hidden = !isSpecialAdjustmentManager();

  const detailToggle = document.getElementById("special-adjustment-detail-toggle");
  if (detailToggle) detailToggle.hidden = !isSpecialAdjustmentManager();

  const detail = document.getElementById("detail-special-adjustment");
  if (detail && !isSpecialAdjustmentManager()) detail.hidden = true;
}

function updateOvertimeVisibility() {
  const exempt = isOvertimeExempt();
  document.getElementById("ot-hours-fields").hidden = exempt;
  document.getElementById("ot-management-note").hidden = !exempt;
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
  const group = document.getElementById(`merit-grade-${period}`);
  const staffType = currentMeritStaffTypeKey();
  const category = MERIT_RATE_CATEGORIES[staffType];
  group.innerHTML = "";
  category.grades
    .filter((g) => g.rate != null)
    .forEach((g) => {
      const label = document.createElement("label");
      label.className = "radio-option";
      const input = document.createElement("input");
      input.type = "radio";
      input.id = `merit-grade-${period}-${g.key}`;
      input.name = `merit-grade-${period}`;
      input.value = g.key;
      input.checked = g.key === "good";
      label.append(input, document.createTextNode(splitGradeLabel(g.label).name));
      group.appendChild(label);
    });
  updateMeritGradeNote(period);
  updateMeritRateInput(period);
}

/**
 * 選択中の勤務成績区分に対応する成績率（下限値、100分率）を成績率の入力欄に反映する。
 * 幅のある区分（特に優秀・優秀等）はMERIT_RATE_CATEGORIESが下限値を保持しているため、
 * そのまま入力欄に反映すればよい。入力欄自体は編集可能なままにし、下限以外の値でも
 * 計算できるようにする（currentMeritRateは入力欄の値をそのまま使う）。
 */
function updateMeritRateInput(period) {
  const input = document.getElementById(`merit-rate-${period}`);
  if (!input) return;
  const grade = currentMeritGrade(period);
  if (grade && grade.rate != null) {
    input.value = Number((grade.rate * 100).toFixed(4));
  }
  updateMeritRateConstraints(period);
}

/** 選択中の成績区分に合わせて、成績率入力欄の許容範囲を設定する。 */
function updateMeritRateConstraints(period) {
  const input = document.getElementById(`merit-rate-${period}`);
  const grade = currentMeritGrade(period);
  if (!input || !grade || grade.rate == null) return;
  input.min = String(grade.minRate * 100);
  if (Number.isFinite(grade.maxRate)) {
    input.max = String(grade.maxRate * 100);
  } else {
    input.removeAttribute("max");
  }
  // 良好等、上限・下限が同じ（＝固定値）の区分ではプラマイボタンを押しても値が変わらないため、
  // 押せないことが分かるようにボタン自体を無効化する。
  const isFixedRate = grade.minRate === grade.maxRate;
  document.querySelectorAll(`.merit-rate-btn[data-period="${period}"]`).forEach((btn) => {
    btn.disabled = isFixedRate;
  });
}

/** 確定時に空欄・範囲外の成績率を、選択中の区分で許容される値に戻す。 */
function normalizeMeritRateInput(period) {
  const input = document.getElementById(`merit-rate-${period}`);
  const grade = currentMeritGrade(period);
  if (!input || !grade || grade.rate == null) return;
  const value = Number(input.value);
  const rate = Number.isFinite(value) ? value / 100 : grade.rate;
  const maxRate = Number.isFinite(grade.maxRate) ? grade.maxRate : Infinity;
  input.value = Number((Math.min(Math.max(rate, grade.minRate), maxRate) * 100).toFixed(4));
}

/** 現在選択中の勤務成績区分の成績率の詳細を、選択欄の下のヒントテキストに表示する */
function updateMeritGradeNote(period) {
  const note = document.getElementById(`merit-grade-${period}-note`);
  if (!note) return;
  const staffType = currentMeritStaffTypeKey();
  const gradeKey = radioValue(`merit-grade-${period}`);
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
  populateSpecialAdjustmentCategoryOptions();
  updateSpecialAdjustmentVisibility();
  ["june", "december"].forEach((period) => {
    populateMeritGradeOptions(period);
  });
  updateSpecialAdjustmentAmountHint();
}

// 昇格操作は直前の1回分だけ戻せる。ページ再読込後や手動変更後は保持しない。
let promotionUndoState = null;
let isApplyingPromotion = false;

function updatePromotionControls() {
  const actions = document.getElementById("promotion-actions");
  const promotionHint = document.getElementById("promotion-hint");
  const promoteButton = document.getElementById("promote-grade");
  const undoButton = document.getElementById("undo-promotion");
  const gradeSelect = document.getElementById("grade");
  const stepSelect = document.getElementById("step");
  if (!actions || !promoteButton || !undoButton || !gradeSelect || !stepSelect) return;

  const targetGrade = Number(gradeSelect.value) + 1;
  const targetStep = getPromotionTargetStep(currentTableKey(), targetGrade, Number(stepSelect.value));
  const isAvailable = currentTableType() === "graded" && targetStep !== null;
  actions.hidden = !isAvailable && !promotionUndoState;
  if (promotionHint) promotionHint.hidden = actions.hidden;
  promoteButton.disabled = !isAvailable;
  undoButton.hidden = !promotionUndoState;
}

function applyPromotionGradeAndStep(grade, step) {
  const gradeSelect = document.getElementById("grade");
  const stepSelect = document.getElementById("step");
  isApplyingPromotion = true;
  gradeSelect.value = String(grade);
  gradeSelect.dispatchEvent(new Event("input", { bubbles: true }));
  stepSelect.value = String(step);
  stepSelect.dispatchEvent(new Event("input", { bubbles: true }));
  isApplyingPromotion = false;
  updatePromotionControls();
}

function initPromotionControls() {
  const promoteButton = document.getElementById("promote-grade");
  const undoButton = document.getElementById("undo-promotion");
  const gradeSelect = document.getElementById("grade");
  const stepSelect = document.getElementById("step");
  if (!promoteButton || !undoButton || !gradeSelect || !stepSelect) return;

  promoteButton.addEventListener("click", () => {
    const grade = Number(gradeSelect.value);
    const step = Number(stepSelect.value);
    const targetStep = getPromotionTargetStep(currentTableKey(), grade + 1, step);
    if (targetStep === null) return;
    promotionUndoState = { grade, step };
    applyPromotionGradeAndStep(grade + 1, targetStep);
  });

  undoButton.addEventListener("click", () => {
    if (!promotionUndoState) return;
    const { grade, step } = promotionUndoState;
    promotionUndoState = null;
    applyPromotionGradeAndStep(grade, step);
  });

  [gradeSelect, stepSelect].forEach((select) => {
    select.addEventListener("input", () => {
      if (!isApplyingPromotion) promotionUndoState = null;
      updatePromotionControls();
    });
  });
  updatePromotionControls();
}

function initForm() {
  const saved = loadFormState("index");
  const form = document.getElementById("calc-form");

  populateVintageOptions();
  populateSalaryTableOptions(saved && saved["salary-table"]);
  populateGradeOptions(saved && saved.grade);
  populateStepOptions();
  populateRegionalRateOptions();
  detailedRegionalAllowance.populatePrefectureOptions();
  detailedRegionalAllowance.populateMunicipalityOptions();
  ["child-under15-count", "child-16to22-count", "parent-count"].forEach(populateDependentCountOptions);

  // 職員区分（ラジオボタン）は勤勉手当の成績率区分にも影響するため、
  // 成績率区分の選択肢を正しいカテゴリで生成できるよう先に復元しておく。
  const savedSpecialAdjustmentType = saved && saved["special-adjustment-type"];
  if (savedSpecialAdjustmentType === "manager" || savedSpecialAdjustmentType === "general") {
    const radio = document.getElementById(
      savedSpecialAdjustmentType === "manager" ? "special-adjustment-type-manager" : "special-adjustment-type-general"
    );
    if (radio) radio.checked = true;
  }
  populateSpecialAdjustmentCategoryOptions();
  updateSpecialAdjustmentVisibility(); // 復元した級・区分の組み合わせが無効なら一般職員に戻す
  ["june", "december"].forEach((period) => {
    populateMeritGradeOptions(period);
  });
  updateVisibility();
  applySavedFormValues(form, saved);
  // 旧形式の保存データには設定方法がないため、地域の保存有無から自然な入力方法を引き継ぐ。
  if (saved && saved["regional-input-method"] === undefined) {
    const method = saved["regional-municipality"] ? "location" : "rate";
    const radio = document.querySelector(`input[name="regional-input-method"][value="${method}"]`);
    if (radio) radio.checked = true;
  }
  // 都道府県の復元後に市区町村等の選択肢を生成し直さないと、保存済みの市区町村等を選択できない。
  detailedRegionalAllowance.populateMunicipalityOptions();
  if (saved && saved["regional-municipality"]) {
    document.getElementById("regional-municipality").value = saved["regional-municipality"];
  }
  updateRegionalInputMethod();
  detailedRegionalAllowance.updateRateStatus();
  populateStepOptions(); // 復元した俸給表・級に対して号俸を範囲内にクランプし直す
  updateVisibility(); // 復元したhousing-eligible等の値を反映し直す
  updateSpecialAdjustmentVisibility(); // 復元したspecial-adjustment-typeの値を反映し直す
  updateOvertimeVisibility(); // 復元した職員区分の値を反映し直す
  updateHonshoAmountHint();
  updateHousingAmountHint();
  updateParentAllowanceHint();
  updateSpecialAdjustmentAmountHint();
  updateMeritGradeNote("june"); // 復元した勤務成績区分の値を反映し直す
  updateMeritGradeNote("december");
  ["june", "december"].forEach((period) => {
    updateMeritRateConstraints(period);
    normalizeMeritRateInput(period);
  });
  wireCounterButtons(form);
  initHintToggles();
  initPromotionControls();

  wireCommonFormEvents(form, {
    onInputExtra: (e) => {
      const wasManager = isSpecialAdjustmentManager();

      if (e.target.id === "salary-table") {
        populateSpecialAdjustmentCategoryOptions();
      }
      if (e.target.id === "grade") {
        populateSpecialAdjustmentCategoryOptions();
      }
      updateSpecialAdjustmentVisibility(); // 級変更等で対象外になった場合はここで一般職員に自動リセットされる
      updateSpecialAdjustmentAmountHint();

      // 職員区分（一般職員／特定管理職員）が実際に変わった場合のみ、勤勉手当の成績率区分を
      // 作り直す（毎回作り直すと号俸変更のたびに選択中の成績区分がリセットされてしまうため）。
      const categoryMayHaveChanged =
        e.target.id === "salary-table" ||
        e.target.name === "special-adjustment-type" ||
        wasManager !== isSpecialAdjustmentManager();
      if (categoryMayHaveChanged) {
        ["june", "december"].forEach((period) => populateMeritGradeOptions(period));
      }
      if (e.target.name === "merit-grade-june") {
        updateMeritGradeNote("june");
        updateMeritRateInput("june");
      }
      if (e.target.name === "merit-grade-december") {
        updateMeritGradeNote("december");
        updateMeritRateInput("december");
      }
      if (["salary-table", "grade", "step"].includes(e.target.id)) {
        updatePromotionControls();
      }
      // 号（指定職俸給表の8号など）が変わると「優秀」の成績率の固定/範囲が変わりうるため、
      // 入力欄の許容範囲と表示値を選択中の号に合わせて更新し直す。
      if (e.target.id === "step") {
        ["june", "december"].forEach((period) => {
          updateMeritRateConstraints(period);
          normalizeMeritRateInput(period);
        });
      }
    },
    onChangeExtra: handleVintageChange,
    onRecalculate: recalculate,
  });

  ["june", "december"].forEach((period) => {
    document.getElementById(`merit-rate-${period}`).addEventListener("change", () => {
      normalizeMeritRateInput(period);
      recalculate();
    });
  });

  document.querySelectorAll(".merit-rate-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const period = btn.dataset.period;
      const input = document.getElementById(`merit-rate-${period}`);
      const grade = currentMeritGrade(period);
      const delta = Number(btn.dataset.delta);
      if (!input || !grade || !Number.isFinite(delta)) return;
      const current = Number(input.value);
      const value = Number.isFinite(current) ? current / 100 : grade.rate;
      const maxRate = Number.isFinite(grade.maxRate) ? grade.maxRate : Infinity;
      const next = Math.min(Math.max(value + delta / 100, grade.minRate), maxRate);
      input.value = Number((next * 100).toFixed(4));
      recalculate();
    });
  });

  document.querySelectorAll(".step-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const stepInput = document.getElementById("step");
      const maxStep = getMaxStep(currentTableKey(), document.getElementById("grade").value);
      const delta = Number(btn.dataset.delta);
      const next = Math.min(Math.max((Number(stepInput.value) || 1) + delta, 1), maxStep);
      stepInput.value = next;
      promotionUndoState = null;
      updatePromotionControls();
      recalculate();
    });
  });

  document.getElementById("reset-saved-input").addEventListener("click", () => {
    clearFormState("index");
    location.reload();
  });

  recalculate();
}

/** 現在表示中のモードの計算結果パネル（.result-hero等）を返す。 */
function activePanelElement() {
  return document.getElementById(activeMode() === "simple" ? "simple-mode-panel" : "detailed-mode-panel");
}

/**
 * スマホ版フローティング表示（年収概算）の金額を、現在表示中のモードの計算結果パネルの
 * 年収に合わせる。かんたんモード・本格計算モードはそれぞれ自分の入力変更時にだけ再計算するため
 * （非表示中のパネルの入力は操作できない）、ここでは再計算はせず、既に描画済みの値を読むだけでよい。
 */
function syncFloatingResult() {
  const activePanel = activePanelElement();
  const heroValue = activePanel && activePanel.querySelector(".result-hero-value");
  const floatingValue = document.getElementById("r-annual-floating");
  if (heroValue && floatingValue) floatingValue.textContent = heroValue.textContent;
}

/**
 * スマホ版フローティング表示と、計算結果パネル内の実際の年収概算（.result-hero）が
 * 画面上で重複しないよう、実物が画面内に入っている間はフローティング側を隠す。
 * かんたんモード／本格計算モードで .result-hero がそれぞれ独立して存在するため、
 * 監視対象は1つのIntersectionObserverのままタブ切替のたびに張り替える。
 */
const floatingResultObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            document.getElementById("mobile-floating-result").hidden = entry.isIntersecting;
          });
        },
        { threshold: 0 }
      )
    : null;
let observedResultHero = null;

function observeActiveResultHero() {
  if (!floatingResultObserver) return;
  const activePanel = activePanelElement();
  const target = activePanel && activePanel.querySelector(".result-hero");
  if (target === observedResultHero) return;
  if (observedResultHero) floatingResultObserver.unobserve(observedResultHero);
  observedResultHero = target || null;
  if (target) floatingResultObserver.observe(target);
}

const ACTIVE_TAB_STORAGE_KEY = "salary-calculator:active-tab";

/**
 * かんたんモード／本格計算モードを切り替える。選択状態はlocalStorageに保存し、次回アクセス時も復元する。
 * 各モードは自分の入力が変わるたびに既に再計算・描画済みのため（非表示中は入力操作できない）、
 * ここでは表示の切替とフローティング表示の同期だけを行い、再計算はしない。
 */
function switchMode(mode) {
  const isSimple = mode === "simple";
  document.getElementById("simple-mode-panel").hidden = !isSimple;
  document.getElementById("detailed-mode-panel").hidden = isSimple;
  document.getElementById("tab-simple").setAttribute("aria-selected", String(isSimple));
  document.getElementById("tab-detailed").setAttribute("aria-selected", String(!isSimple));
  document.getElementById("tab-simple").classList.toggle("is-active", isSimple);
  document.getElementById("tab-detailed").classList.toggle("is-active", !isSimple);
  try {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, mode);
  } catch {
    // プライベートブラウジング等でlocalStorageが使えない場合は記憶をあきらめる
  }
  syncFloatingResult();
  observeActiveResultHero();
}

function initModeTabs() {
  const tabSimple = document.getElementById("tab-simple");
  const tabDetailed = document.getElementById("tab-detailed");
  if (!tabSimple || !tabDetailed) return;
  tabSimple.addEventListener("click", () => switchMode("simple"));
  tabDetailed.addEventListener("click", () => switchMode("detailed"));

  let initialMode = "simple";
  try {
    const saved = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (saved === "detailed" || saved === "simple") initialMode = saved;
  } catch {
    // 読み込めない場合は既定のかんたんモードのまま
  }
  switchMode(initialMode);
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await Promise.all([loadVintages(), loadAllowanceRates()]);
    const initialVintage = getVintage(CURRENT_VINTAGE_KEY);
    await loadOfficialSalaryTable(initialVintage && initialVintage.file);
    updateTableSourceNote();
    renderTerminalAllowanceRateNote();
    initForm();
    initSimpleForm();
    initModeTabs();
  } catch (error) {
    console.error(error);
    document.getElementById("terminal-allowance-rate-note").textContent =
      "支給月数データを読み込めないため、計算を開始できません。";
  }
});
