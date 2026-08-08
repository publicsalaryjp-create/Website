/**
 * simple-mode.js
 * 「かんたんモード」用のフォーム制御・計算ロジック。
 * 詳細モード（js/app.js, js/form-controls.js）とは入力状態を独立させており、
 * 「役職・年齢の目安」で選んだ代表的な役職に応じた俸給表・級・号俸・職員区分・
 * 俸給の特別調整額を自動で適用する（SIMPLE_ROLE_LEVELS参照）。住居手当はなしと仮定する
 * （本府省業務調整手当は東京都特別区を選んだ場合のみ加算）。
 * 前提にするDOM ID: simple-calc-form, simple-salary-vintage-group, simple-vintage-note,
 * simple-role-level, simple-role-level-status, simple-regional-prefecture,
 * simple-regional-municipality, simple-regional-rate, simple-regional-rate-status, simple-dependent-count,
 * simple-dependent-field, simple-dependent-exempt-note, simple-overtime-hours,
 * simple-ot-hours-field, simple-ot-management-note, simple-reset-saved-input, simple-go-detailed,
 * simple-result-table-diff-header, simple-result-table-amount-header。結果の描画先id
 * （simple-r-base〜simple-r-annual-hero）は
 * js/form-controls.jsのrenderSalaryResult()・SALARY_RESULT_ID_SUFFIXESが前提にする
 * 詳細モードと共通の命名規則（"simple-r-"+項目名）に従う。
 * 俸給表バージョン（CURRENT_VINTAGE_KEY）はページ全体で共有するデータのため、
 * js/app.js（詳細モード）と相互に同期する（syncDetailedFormAfterVintageChange /
 * syncSimpleFormAfterVintageChange）。
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

  // 選択中の役職・年齢の目安に対応する級・号俸を、地域手当の支給割合と同じ見た目（緑地）で明示する。
  const roleLevelStatus = document.getElementById("simple-role-level-status");
  if (roleLevelStatus) {
    roleLevelStatus.textContent = isDesignated
      ? `設定された号俸: 指定職${role.step}号`
      : `設定された級・号俸: ${role.grade}級${role.step}号`;
    roleLevelStatus.classList.add("is-selected");
  }
}

/** 俸給表バージョンの切替（js/app.jsのhandleVintageChange）を受けて、かんたんモードの
 * ラジオ選択・注記・計算結果を再同期する。 */
function syncSimpleFormAfterVintageChange() {
  populateVintageOptions("simple-salary-vintage-group", "simple-salary-vintage");
  updateVintageNote("simple-vintage-note");
  simpleRecalculate();
}

/**
 * かんたんモードの俸給表バージョンのラジオボタンの変更を受けて、全モード共通のバージョン
 * （CURRENT_VINTAGE_KEY）を切り替える。詳細モード側の選択状態・注記・計算結果も合わせて同期する
 * （js/app.jsのhandleVintageChangeと対になる処理）。
 */
async function handleSimpleVintageChange(e) {
  if (e.target.name !== "simple-salary-vintage") return;
  const selectedKey = e.target.value;
  const switched = await switchVintage(selectedKey);
  if (!switched) {
    // 未登録バージョンは選べないので元に戻す
    const original = document.getElementById(`simple-salary-vintage-${CURRENT_VINTAGE_KEY}`);
    if (original) original.checked = true;
  }
  populateVintageOptions("simple-salary-vintage-group", "simple-salary-vintage");
  updateVintageNote("simple-vintage-note");
  syncDetailedFormAfterVintageChange();
  recalculate();
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

/**
 * @param {Object} result 選択中の俸給表バージョンでの計算結果
 * @param {Object|null} [baselineResult] 比較基準（現行）バージョンでの計算結果。
 *   渡すと各項目に「現行（勧告前）」との差額を併記する（hasVintageComparison参照）。
 */
function renderSimpleResult(result, baselineResult) {
  renderSalaryResult("simple-r-", result, baselineResult);
  updateDiffHeader(
    "simple-result-table-diff-header",
    "simple-result-table-amount-header",
    "simple-result-table",
    !!baselineResult
  );
  syncFloatingResult();
}

function simpleRecalculate() {
  saveFormState("simple", document.getElementById("simple-calc-form"));
  updateSimpleFieldVisibility();
  const input = readSimpleInput();
  const result = calculateSalary(input);
  const baselineResult = hasVintageComparison() ? calculateSalary(input, BASELINE_SALARY_CATALOG) : null;
  renderSimpleResult(result, baselineResult);
}

function initSimpleForm() {
  const form = document.getElementById("simple-calc-form");
  if (!form) return;
  const saved = loadFormState("simple");

  populateVintageOptions("simple-salary-vintage-group", "simple-salary-vintage");
  updateVintageNote("simple-vintage-note");
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

  form.addEventListener("change", async (e) => {
    if (e.target.id === "simple-regional-prefecture") {
      simpleRegionalAllowance.populateMunicipalityOptions();
    }
    if (e.target.id === "simple-regional-municipality") {
      simpleRegionalAllowance.applyMunicipalitySelection();
    }
    await handleSimpleVintageChange(e);
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
