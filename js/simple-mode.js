/**
 * simple-mode.js
 * 「かんたんモード」用のフォーム制御・計算ロジック。
 * 詳細モード（js/app.js, js/form-controls.js）とは入力状態を独立させており、
 * 「役職・年齢の目安」で選んだ代表的な役職に応じた俸給表・級・号俸・職員区分・
 * 俸給の特別調整額を自動で適用する（SIMPLE_ROLE_LEVELS参照）。住居手当はなしと仮定する
 * （本府省業務調整手当は東京都特別区を選んだ場合のみ加算）。
 * 前提にするDOM ID: simple-calc-form, simple-role-level, simple-regional-prefecture,
 * simple-regional-municipality, simple-regional-rate, simple-regional-rate-status,
 * simple-dependent-count, simple-dependent-field, simple-dependent-exempt-note,
 * simple-overtime-hours, simple-ot-hours-field, simple-ot-management-note, simple-r-monthly,
 * simple-r-honsho, simple-r-special-adjustment, simple-r-overtime, simple-r-bonus,
 * simple-r-annual, simple-r-annual-hero, simple-reset-saved-input, simple-go-detailed。
 */

// 人事院・内閣人事局公表のモデル給与（本府省）の代表的な役職・年齢の水準。
// 級・号俸・俸給の特別調整額の区分は、各役職の標準的な位置づけに基づく代表値であり、
// 実際の格付けは個人ごとに異なる（あくまで目安）。
const SIMPLE_ROLE_LEVELS = [
  { key: "clerk22", label: "22歳 係員", tableKey: "administrative_1", grade: 2, step: 1, specialAdjustmentCategory: null, staffType: "general" },
  { key: "supervisor28", label: "28歳 係長", tableKey: "administrative_1", grade: 3, step: 5, specialAdjustmentCategory: null, staffType: "general" },
  { key: "assistant35", label: "35歳 課長補佐", tableKey: "administrative_1", grade: 6, step: 1, specialAdjustmentCategory: null, staffType: "general" },
  { key: "director40", label: "40歳 室長", tableKey: "administrative_1", grade: 7, step: 1, specialAdjustmentCategory: "type2", staffType: "senior_manager" },
  { key: "chief50", label: "50歳 課長", tableKey: "administrative_1", grade: 9, step: 4, specialAdjustmentCategory: "type1", staffType: "senior_manager" },
  { key: "bureauChief", label: "局長", tableKey: "designated", grade: null, step: 4, specialAdjustmentCategory: null, staffType: "designated" },
  { key: "viceMinister", label: "事務次官", tableKey: "designated", grade: null, step: 8, specialAdjustmentCategory: null, staffType: "designated" },
];

// 本府省業務調整手当（本省手当）は東京都特別区（霞が関等）勤務の場合のみ自動加算する。
// REGIONAL_ALLOWANCE_LOCATIONSでの一意なコード（js/regional-allowance-locations.js参照）。
const SIMPLE_HONSHO_MUNICIPALITY_CODE = "13100:特別区";

/** 「役職・年齢の目安」プルダウン（simple-role-level）に選択肢を生成する。値はSIMPLE_ROLE_LEVELSの添字。 */
function populateSimpleRoleLevelOptions() {
  const select = document.getElementById("simple-role-level");
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = "";
  SIMPLE_ROLE_LEVELS.forEach((role, index) => {
    const opt = document.createElement("option");
    opt.value = index;
    opt.textContent = role.label;
    select.appendChild(opt);
  });
  const maxIndex = SIMPLE_ROLE_LEVELS.length - 1;
  const candidate = Number(currentValue);
  select.value = Number.isInteger(candidate) && candidate >= 0 && candidate <= maxIndex ? String(candidate) : "0";
}

/** 選択中の役職・年齢の目安（SIMPLE_ROLE_LEVELSの要素）を返す。未選択時は先頭（22歳係員）。 */
function currentSimpleRoleLevel() {
  const select = document.getElementById("simple-role-level");
  const index = select ? Number(select.value) : 0;
  return SIMPLE_ROLE_LEVELS[index] || SIMPLE_ROLE_LEVELS[0];
}

/** 選択中の市区町村が東京都特別区かどうか（本省手当の自動判定に使う） */
function isSimpleHonshoEligible() {
  const municipalitySelect = document.getElementById("simple-regional-municipality");
  return !!municipalitySelect && municipalitySelect.value === SIMPLE_HONSHO_MUNICIPALITY_CODE;
}

// 管理職（俸給の特別調整額の対象・指定職職員）は超過勤務手当の支給対象外のため、時間を0として扱う
// （js/app.jsのisOvertimeExempt()と同じ考え方）。
function isSimpleOvertimeExempt(role) {
  return role.tableKey === "designated" || !!role.specialAdjustmentCategory;
}

/**
 * 選択中の役職に応じて、支給対象外の項目の入力欄を隠して注記を表示する。
 * 残業時間: 管理職・指定職職員は超過勤務手当の対象外（isSimpleOvertimeExempt参照）。
 * 扶養家族: 指定職職員は扶養手当の対象外（js/form-controls.jsのupdateVisibility()と同じ考え方）。
 */
function updateSimpleFieldVisibility() {
  const role = currentSimpleRoleLevel();
  const overtimeExempt = isSimpleOvertimeExempt(role);
  const hoursField = document.getElementById("simple-ot-hours-field");
  const managementNote = document.getElementById("simple-ot-management-note");
  if (hoursField) hoursField.hidden = overtimeExempt;
  if (managementNote) managementNote.hidden = !overtimeExempt;

  const isDesignated = role.tableKey === "designated";
  const dependentField = document.getElementById("simple-dependent-field");
  const dependentExemptNote = document.getElementById("simple-dependent-exempt-note");
  if (dependentField) dependentField.hidden = isDesignated;
  if (dependentExemptNote) dependentExemptNote.hidden = !isDesignated;
}

// 都道府県→市区町村→支給割合の入力ロジックは詳細モードと共通（js/form-controls.jsの
// createRegionalAllowanceController参照）。かんたんモードは支給割合を直接選ぶ手段がないため、
// 市区町村の選択を解除したら支給割合を0にリセットする（resetRateOnClear: true）。
const simpleRegionalAllowance = createRegionalAllowanceController({
  prefecture: "simple-regional-prefecture",
  municipality: "simple-regional-municipality",
  rate: "simple-regional-rate",
  rateStatus: "simple-regional-rate-status",
  resetRateOnClear: true,
});

/**
 * かんたんモードの入力値を calculateSalary() の入力形式に変換する。
 * 俸給表・級・号俸・職員区分・俸給の特別調整額は、選択中の役職・年齢の目安（SIMPLE_ROLE_LEVELS）に従う。
 * 本省手当は、勤務地に東京都特別区を選んでいる場合のみ自動計算する。勤務成績は各職員区分の「良好」を仮定する。
 */
function readSimpleInput() {
  const role = currentSimpleRoleLevel();
  const overtimeExempt = isSimpleOvertimeExempt(role);
  const regionalRate = Number(document.getElementById("simple-regional-rate").value) || 0;
  const dependentCount = Number(document.getElementById("simple-dependent-count").value) || 0;
  const overtimeHours = overtimeExempt ? 0 : Math.round(Number(document.getElementById("simple-overtime-hours").value) || 0);
  const terminalRates = ALLOWANCE_RATES.terminalAllowance[role.staffType];
  const meritGrades = MERIT_RATE_CATEGORIES[role.staffType].grades;
  const goodMeritRate = meritGrades.find((g) => g.key === "good").rate;

  return {
    tableKey: role.tableKey,
    grade: role.grade,
    step: role.step,
    regionalRate,
    childUnder15Count: dependentCount,
    child16to22Count: 0,
    parentCount: 0,
    housingAllowance: 0,
    honshoAllowance: isSimpleHonshoEligible() ? getHonshoAllowanceAmountForTable(role.tableKey, role.grade) : 0,
    specialAdjustmentAllowance: role.specialAdjustmentCategory
      ? getSpecialAdjustmentAmount(role.tableKey, role.grade, role.specialAdjustmentCategory)
      : 0,
    managementBonusAdditionRate:
      role.tableKey === "designated"
        ? 0.25
        : role.specialAdjustmentCategory
          ? getManagementBonusAdditionRate(role.specialAdjustmentCategory)
          : 0,
    teishuMonthsJune: terminalRates["2026-06"],
    teishuMonthsDecember: terminalRates["2026-12"],
    bonusRoleStageAdditionRate: getBonusRoleStageAdditionRate(role.tableKey, role.grade),
    meritRateJune: goodMeritRate,
    meritRateDecember: goodMeritRate,
    // 平日の時間外勤務（深夜・休日を除く）としてのみ概算する
    weekdayNormalHours: Math.max(0, overtimeHours),
    weekdayNightHours: 0,
    holidayNormalHours: 0,
    holidayNightHours: 0,
  };
}

function renderSimpleResult(result) {
  document.getElementById("simple-r-monthly").textContent = yen.format(result.monthlyTotalWithOvertime);
  document.getElementById("simple-r-honsho").textContent = yen.format(result.honshoAllowance);
  document.getElementById("simple-r-special-adjustment").textContent = yen.format(result.specialAdjustmentAllowance);
  document.getElementById("simple-r-overtime").textContent = yen.format(result.overtimeAllowance);
  document.getElementById("simple-r-bonus").textContent = yen.format(result.bonusAnnual);
  document.getElementById("simple-r-annual").textContent = yen.format(result.annualIncome);
  document.getElementById("simple-r-annual-hero").textContent = yen.format(result.annualIncome);
  syncFloatingResult();
}

function simpleRecalculate() {
  saveFormState("simple", document.getElementById("simple-calc-form"));
  updateSimpleFieldVisibility();
  renderSimpleResult(calculateSalary(readSimpleInput()));
}

function initSimpleForm() {
  const form = document.getElementById("simple-calc-form");
  if (!form) return;
  const saved = loadFormState("simple");

  populateSimpleRoleLevelOptions();
  simpleRegionalAllowance.populatePrefectureOptions();
  populateDependentCountOptions("simple-dependent-count");

  applySavedFormValues(form, saved);
  // 都道府県の復元後に市区町村等の選択肢を生成し直さないと、保存済みの市区町村等を選択できない。
  simpleRegionalAllowance.populateMunicipalityOptions();
  if (saved && saved["simple-regional-municipality"]) {
    document.getElementById("simple-regional-municipality").value = saved["simple-regional-municipality"];
  }
  simpleRegionalAllowance.updateRateStatus();

  wireCounterButtons(form);

  form.addEventListener("input", () => simpleRecalculate());

  form.addEventListener("change", (e) => {
    if (e.target.id === "simple-regional-prefecture") {
      simpleRegionalAllowance.populateMunicipalityOptions();
    }
    if (e.target.id === "simple-regional-municipality") {
      simpleRegionalAllowance.applyMunicipalitySelection();
    }
    simpleRecalculate();
  });

  const resetButton = document.getElementById("simple-reset-saved-input");
  if (resetButton) {
    resetButton.addEventListener("click", () => {
      clearFormState("simple");
      location.reload();
    });
  }

  const goDetailedButton = document.getElementById("simple-go-detailed");
  if (goDetailedButton) {
    goDetailedButton.addEventListener("click", () => switchMode("detailed"));
  }

  simpleRecalculate();
}
