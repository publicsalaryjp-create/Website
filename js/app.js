/**
 * app.js
 * index.html 固有のDOM配線。共通のフォーム制御・表示ロジックは js/form-controls.js を使う。
 */

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
  const category = getMeritCategory(staffType, period);
  const grade = category && category.grades.find((g) => g.key === gradeKey);
  // 指定職俸給表8号（事務次官等）は「優秀」の成績率が107.5/100（人事院勧告反映後の12月期は
  // 110/100）の固定値になる特例。指定職俸給表は級の概念がないflat型で、
  // 号（document.getElementById("step")）がそのまま俸給表steps配列のインデックスに
  // 対応するため、grade（職務の級）ではなくstepを見る。
  const designatedStep = Number(document.getElementById("step").value);
  if (grade && staffType === "designated" && gradeKey === "excellent" && designatedStep === 8) {
    const fixedRate = getDesignatedStep8ExcellentRate(period);
    return { ...grade, rate: fixedRate, minRate: fixedRate, maxRate: fixedRate };
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
    teishuMonthsJune: terminalRates.june,
    teishuMonthsDecember: terminalRates.december,
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

/**
 * 比較基準（現行）バージョンの期末手当支給月数を、選択中の職員区分について返す。
 * 期末手当の支給月数はバージョンごとに異なりうるため、baselineResult計算時は
 * readInput()の値をそのまま使い回さず、この値で上書きする（recalculate参照）。
 */
function baselineTerminalMonths() {
  const terminalRates = BASELINE_ALLOWANCE_RATES.terminalAllowance[currentMeritStaffTypeKey()];
  return { teishuMonthsJune: terminalRates.june, teishuMonthsDecember: terminalRates.december };
}

function renderTerminalAllowanceRateNote() {
  const staffType = currentMeritStaffTypeKey();
  const terminal = ALLOWANCE_RATES.terminalAllowance[staffType];
  const label = MERIT_RATE_CATEGORIES[staffType].label;
  const year = ALLOWANCE_RATES.fiscalYear;
  document.getElementById("terminal-allowance-rate-note").textContent =
    `${label}: ${year}年6月期 ${terminal.june}月分／${year}年12月期 ${terminal.december}月分`;
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

/**
 * @param {Object} result 選択中の俸給表バージョンでの計算結果
 * @param {Object|null} [baselineResult] 比較基準（現行）バージョンでの計算結果。
 *   渡すと各項目に「現行（勧告前）」との差額を併記する（hasVintageComparison参照）。
 */
function renderResult(result, baselineResult) {
  renderTerminalAllowanceRateNote();
  renderSalaryResult("r-", result, baselineResult);
  renderOvertimeRateHints(result.overtimeHourlyWage);
  updateDiffHeader("result-table-diff-header", "result-table-amount-header", "result-table", !!baselineResult);
  syncFloatingResult();
  document.getElementById("ot-warning").hidden = result.overtimeExcessHours <= 0;
}

/**
 * 職務の級で選択可能な俸給の特別調整額の区分（一種〜五種等）をプルダウンに反映する。
 * 俸給表バージョンの切替など、級はそのままで選択肢を作り直すだけの場合は、選択中の区分を
 * 維持する（新しい選択肢に含まれなくなった場合のみ先頭の区分にフォールバックする）。
 */
function populateSpecialAdjustmentCategoryOptions() {
  const select = document.getElementById("special-adjustment-category");
  const grade = Number(document.getElementById("grade").value);
  const options = getSpecialAdjustmentOptions(currentTableKey(), grade);
  const currentValue = select.value;
  select.innerHTML = "";
  options.forEach((opt) => {
    const el = document.createElement("option");
    el.value = opt.key;
    el.textContent = opt.label;
    select.appendChild(el);
  });
  if (options.length) {
    select.value = options.some((opt) => opt.key === currentValue) ? currentValue : options[0].key;
  }
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
  const category = getMeritCategory(staffType, period);
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
  input.min = Number((grade.minRate * 100).toFixed(4));
  if (Number.isFinite(grade.maxRate)) {
    input.max = Number((grade.maxRate * 100).toFixed(4));
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
  const category = getMeritCategory(staffType, period);
  const grade = category && category.grades.find((g) => g.key === gradeKey);
  note.textContent = grade ? splitGradeLabel(grade.label).detail : "";
}

function recalculate() {
  saveFormState("index", document.getElementById("calc-form"));
  updateOvertimeVisibility();
  const input = readInput();
  const result = calculateSalary(input);
  const baselineResult = hasVintageComparison()
    ? calculateSalary(
        {
          ...input,
          ...baselineTerminalMonths(),
          // 6月期・12月期の成績率は選択中バージョン用にシフトされた値がinput側に入っているため、
          // 現行（比較基準）ではそのシフト分を差し引く（getMeritRateShift参照。現行を選んでいる
          // ときはシフト0なので何も変わらない）。
          meritRateJune: input.meritRateJune - getMeritRateShift("june"),
          meritRateDecember: input.meritRateDecember - getMeritRateShift("december"),
        },
        BASELINE_SALARY_CATALOG
      )
    : null;
  renderResult(result, baselineResult);
}

// ---------------------------------------------------------------------------
// 初期化
// ---------------------------------------------------------------------------

/**
 * 俸給表バージョンの切替（CURRENT_VINTAGE_KEYの変更）を受けて、詳細モードの表示・選択肢を
 * 作り直す。かんたんモード側での切替（js/simple-mode.jsのhandleSimpleVintageChange）からも呼ぶため、
 * 独立した関数にしている。呼び出し側で再計算（recalculate()）まで行うこと
 * （詳細モード自身のラジオ操作ではwireCommonFormEvents()側が自動で呼ぶため、ここでは呼ばない）。
 */
function syncDetailedFormAfterVintageChange() {
  populateVintageOptions("salary-vintage-group", "salary-vintage");
  updateVintageNote("vintage-note");
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

async function handleVintageChange(e) {
  if (e.target.name !== "salary-vintage") return;
  const selectedKey = e.target.value;
  const switched = await switchVintage(selectedKey);
  if (!switched) {
    // 未登録バージョンは選べないので元に戻す
    const original = document.getElementById(`salary-vintage-${CURRENT_VINTAGE_KEY}`);
    if (original) original.checked = true;
  }
  syncDetailedFormAfterVintageChange();
  // 俸給表バージョンはページ全体で共有する1つのデータ（CURRENT_VINTAGE_KEY）のため、
  // かんたんモード側の選択状態・注記・計算結果も合わせて同期する。
  syncSimpleFormAfterVintageChange();
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

  populateVintageOptions("salary-vintage-group", "salary-vintage");
  updateVintageNote("vintage-note");
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

/**
 * localStorageに保存された俸給表バージョンの選択（詳細モード・かんたんモードいずれかの
 * ラジオ）をCURRENT_VINTAGE_KEYに反映する。populateVintageOptions()等でフォームを初期化する
 * 前に呼ぶ必要がある。復元後にラジオのchecked属性だけを書き換えても（applySavedFormValues）
 * 実際のデータ切替（switchVintage）は伴わないため、ここで先にCURRENT_VINTAGE_KEYを正しい値に
 * しておくことで、以降の初期読み込みが最初から選択済みバージョンのデータで行われるようにする。
 * 保存データがない、または現在選べないバージョンの場合は何もしない（既定の「現行」のまま）。
 */
function restoreSavedVintageKey() {
  const savedIndex = loadFormState("index");
  const savedSimple = loadFormState("simple");
  const savedKey = (savedIndex && savedIndex["salary-vintage"]) || (savedSimple && savedSimple["simple-salary-vintage"]);
  const vintage = savedKey && getVintage(savedKey);
  if (vintage && vintage.available && vintage.file) {
    CURRENT_VINTAGE_KEY = savedKey;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadVintages();
    restoreSavedVintageKey();
    const initialVintage = getVintage(CURRENT_VINTAGE_KEY);
    await Promise.all([
      loadOfficialSalaryTable(initialVintage && initialVintage.file),
      loadBaselineSalaryTable(),
      loadAllowanceRates(initialVintage && initialVintage.allowanceFile),
      loadBaselineAllowanceRates(),
    ]);
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
