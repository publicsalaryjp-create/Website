/**
 * form-controls.js
 * index.html で使うフォーム制御・表示ロジック。
 * 前提にするDOM ID: salary-table, grade, grade-field, step,
 * regional-rate, regional-prefecture, regional-municipality,
 * child-under15-count, child-16to22-count, parent-count, housing-eligible,
 * housing-amount-field, housing-rent, housing-amount-hint, honsho-eligible-no,
 * honsho-eligible-yes, honsho-amount-hint, table-source-note,
 * r-base, r-regional, r-dependent, r-housing, r-honsho, r-monthly-total。
 * 期末・勤勉手当の入力は js/app.js 側で扱う。
 * activeMode()・createRegionalAllowanceController() はかんたんモード（js/simple-mode.js）
 * とも共有しており、detailed-mode-panel の存在も前提にする。
 */

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });

/** 現在表示中のモード（"simple" または "detailed"）を返す。かんたんモード・本格計算モードの切替に使う。 */
function activeMode() {
  const detailedPanel = document.getElementById("detailed-mode-panel");
  return detailedPanel && !detailedPanel.hidden ? "detailed" : "simple";
}

/** name属性で指定したラジオボタングループの、チェック済み要素のvalueを返す（未チェック時はnull） */
function radioValue(name) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : null;
}

function currentTableKey() {
  return document.getElementById("salary-table").value;
}

function currentTableType() {
  const table = getTable(currentTableKey());
  return table ? table.type : "graded";
}

/**
 * 俸給表のlabel（例:「行政職俸給表(一)　― 一般行政事務など」）を
 * 表名と説明に分割する。プルダウンの選択肢は幅が狭く説明部分が読み切れないため、
 * 説明は別途ヒントテキストとして表示する（updateTableNote参照）。
 */
function splitTableLabel(label) {
  const separator = "　―";
  const idx = label.indexOf(separator);
  if (idx === -1) return { name: label, description: "" };
  return {
    name: label.slice(0, idx),
    description: label.slice(idx + separator.length).trim(),
  };
}

/** 現在選択中の俸給表の説明文を、選択欄の下のヒントテキストに表示する */
function updateTableNote() {
  const note = document.getElementById("table-note");
  if (!note) return;
  const table = getTable(currentTableKey());
  note.textContent = table ? splitTableLabel(table.label).description : "";
}

function populateSalaryTableOptions(defaultKey) {
  const select = document.getElementById("salary-table");
  select.innerHTML = "";
  getVisibleTableKeys().forEach((key) => {
    const table = getTable(key);
    if (!table) return;
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = splitTableLabel(table.label).name;
    select.appendChild(opt);
  });
  if (defaultKey && getVisibleTableKeys().includes(defaultKey)) {
    select.value = defaultKey;
  }
  updateTableNote();
}

function populateGradeOptions(defaultGrade) {
  const gradeSelect = document.getElementById("grade");
  const table = getTable(currentTableKey());
  if (!table || table.type !== "graded") return;
  const grades = Object.keys(table.grades)
    .map(Number)
    .sort((a, b) => a - b);
  const minGrade = grades[0];
  const maxGrade = grades[grades.length - 1];
  const candidate = defaultGrade != null ? Number(defaultGrade) : Number(gradeSelect.value) || minGrade;
  gradeSelect.innerHTML = "";
  grades.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g;
    opt.textContent = `${g}級`;
    gradeSelect.appendChild(opt);
  });
  gradeSelect.value = Math.min(Math.max(candidate, minGrade), maxGrade);
}

function populateStepOptions() {
  const tableKey = currentTableKey();
  const grade = document.getElementById("grade").value;
  const stepSelect = document.getElementById("step");
  const currentValue = Number(stepSelect.value) || 1;
  const maxStep = getMaxStep(tableKey, grade);
  stepSelect.innerHTML = "";
  for (let step = 1; step <= maxStep; step++) {
    const opt = document.createElement("option");
    opt.value = step;
    opt.textContent = `${step}号`;
    stepSelect.appendChild(opt);
  }
  stepSelect.value = Math.min(Math.max(currentValue, 1), maxStep);
}

// 扶養親族数のプルダウン（0人〜MAX_DEPENDENT_COUNT人）の上限
const MAX_DEPENDENT_COUNT = 10;

/** 扶養する子・父母等の数のプルダウン（0人〜10人）を生成する */
function populateDependentCountOptions(selectId) {
  const select = document.getElementById(selectId);
  const currentValue = Number(select.value) || 0;
  select.innerHTML = "";
  for (let count = 0; count <= MAX_DEPENDENT_COUNT; count++) {
    const opt = document.createElement("option");
    opt.value = count;
    opt.textContent = `${count}人`;
    select.appendChild(opt);
  }
  select.value = Math.min(Math.max(currentValue, 0), MAX_DEPENDENT_COUNT);
}

function regionalRateLabel(r) {
  const percent = `${(r.value * 100).toFixed(0)}%`;
  return r.value === 0 ? "0%（非支給地）" : percent;
}

function populateRegionalRateOptions() {
  const select = document.getElementById("regional-rate");
  select.innerHTML = "";
  REGIONAL_ALLOWANCE_RATES.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r.value;
    opt.textContent = regionalRateLabel(r);
    select.appendChild(opt);
  });
  select.value = "0"; // デフォルトは非支給地（0%）
}

/**
 * 地域手当の「都道府県→市区町村→支給割合」の入力を制御するコントローラを作る。
 * 詳細モード（regional-*）・かんたんモード（simple-regional-*）のように、同じ地域データ
 * （REGIONAL_ALLOWANCE_LOCATIONS）を使うが要素idの異なるフォームが複数存在するため、
 * id指定だけで使い回せるようにしている。
 *
 * @param {Object} ids
 * @param {string} ids.prefecture 都道府県セレクトのid
 * @param {string} ids.municipality 市区町村セレクトのid
 * @param {string} ids.rate 支給割合の値を保持する要素のid（<select>または<input type="hidden">。
 *   .value に0〜0.2の数値文字列を保持していればよい）
 * @param {string} [ids.rateStatus] 「設定された支給割合: X%」を表示するヒント要素のid（省略時は更新しない）
 * @param {boolean} [ids.resetRateOnClear] 市区町村の選択を解除したときに支給割合を0にリセットするか
 *   （詳細モードは「支給割合を直接選ぶ」への切替を妨げないようfalse、かんたんモードは
 *   地域選択以外に支給割合を設定する手段がないためtrueにする）
 */
function createRegionalAllowanceController(ids) {
  function populatePrefectureOptions() {
    const select = document.getElementById(ids.prefecture);
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "都道府県を選ぶ";
    select.appendChild(placeholder);
    [...new Set(REGIONAL_ALLOWANCE_LOCATIONS.map((location) => location.prefecture))].forEach((prefecture) => {
      const opt = document.createElement("option");
      opt.value = prefecture;
      opt.textContent = prefecture;
      select.appendChild(opt);
    });
    select.value = currentValue;
  }

  /** 地域から選んだ場合に、自動設定された支給割合を明示する。 */
  function updateRateStatus() {
    if (!ids.rateStatus) return;
    const status = document.getElementById(ids.rateStatus);
    const municipalitySelect = document.getElementById(ids.municipality);
    const rateElement = document.getElementById(ids.rate);
    if (!status || !municipalitySelect || !rateElement) return;
    if (!municipalitySelect.value) {
      status.textContent = "市区町村を選ぶと、地域手当の支給割合が自動で設定されます。";
      status.classList.remove("is-selected");
      return;
    }
    status.textContent = `設定された支給割合: ${regionalRateLabel({ value: Number(rateElement.value) })}`;
    status.classList.add("is-selected");
  }

  function populateMunicipalityOptions() {
    const prefectureSelect = document.getElementById(ids.prefecture);
    const municipalitySelect = document.getElementById(ids.municipality);
    if (!prefectureSelect || !municipalitySelect) return;
    const locations = REGIONAL_ALLOWANCE_LOCATIONS.filter((location) => location.prefecture === prefectureSelect.value);
    municipalitySelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = prefectureSelect.value ? "市区町村等を選ぶ" : "先に都道府県を選ぶ";
    municipalitySelect.appendChild(placeholder);
    locations.forEach((location) => {
      const opt = document.createElement("option");
      opt.value = location.code;
      opt.textContent = location.municipality;
      municipalitySelect.appendChild(opt);
    });
    municipalitySelect.disabled = locations.length === 0;
    updateRateStatus();
  }

  /** 市区町村等の選択を地域手当率に反映する。 */
  function applyMunicipalitySelection() {
    const municipalitySelect = document.getElementById(ids.municipality);
    const rateElement = document.getElementById(ids.rate);
    if (!municipalitySelect || !rateElement) return;
    if (!municipalitySelect.value) {
      if (ids.resetRateOnClear) {
        rateElement.value = "0";
        updateRateStatus();
      }
      return;
    }
    const location = REGIONAL_ALLOWANCE_LOCATIONS.find((item) => item.code === municipalitySelect.value);
    if (!location) return;
    rateElement.value = location.rate;
    updateRateStatus();
    rateElement.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return { populatePrefectureOptions, populateMunicipalityOptions, updateRateStatus, applyMunicipalitySelection };
}

const detailedRegionalAllowance = createRegionalAllowanceController({
  prefecture: "regional-prefecture",
  municipality: "regional-municipality",
  rate: "regional-rate",
  rateStatus: "regional-rate-status",
});

/** 地域手当の設定方法に応じて、地域選択か支給割合選択の一方だけを表示する。 */
function updateRegionalInputMethod() {
  const useLocation = radioValue("regional-input-method") !== "rate";
  const locationInputs = document.getElementById("regional-location-inputs");
  const rateInput = document.getElementById("regional-rate-input");
  if (locationInputs) locationInputs.hidden = !useLocation;
  if (rateInput) rateInput.hidden = useLocation;
  detailedRegionalAllowance.updateRateStatus();
}

/** 本省手当の「支給あり」選択時に、現在の級から自動計算される参考額をヒント表示する */
function updateHonshoAmountHint() {
  const hint = document.getElementById("honsho-amount-hint");
  if (!hint) return;
  if (radioValue("honsho-eligible") !== "1") {
    hint.textContent = "";
    return;
  }
  const tableKey = currentTableKey();
  const isGraded = currentTableType() === "graded";
  const grade = Number(document.getElementById("grade").value);
  const amount = getHonshoAllowanceAmountForTable(tableKey, grade);
  if (!isGraded) {
    hint.textContent = `指定職の参考額: ${yen.format(amount)}`;
  } else if (amount > 0) {
    const gradeLabel = grade >= 7 ? `${grade}級（7級以上）` : `${grade}級`;
    hint.textContent = `${gradeLabel}の参考額: ${yen.format(amount)}`;
  } else {
    hint.textContent = `職務の級が取得できないため自動計算できません（${yen.format(0)}として扱われます）。`;
  }
}

/** 父母等の扶養手当の1人あたり金額をヒント表示する（減額・不支給の詳細は？ボタンの説明文を参照） */
function updateParentAllowanceHint() {
  const hint = document.getElementById("parent-allowance-hint");
  if (!hint) return;
  const grade = Number(document.getElementById("grade").value);
  const rate = getParentAllowanceRate(currentTableKey(), grade);
  hint.textContent = `1人あたり${yen.format(rate)}`;
}

/**
 * 父母等の扶養手当は、行政職俸給表(一)の9級以上職員等では支給されないため、
 * 「扶養する父母等の数」の入力欄自体を隠し、値も0にリセットする。
 */
function updateParentCountVisibility() {
  const field = document.getElementById("parent-count-field");
  if (!field) return;
  const grade = Number(document.getElementById("grade").value);
  const hide = currentTableKey() === "administrative_1" && grade >= 9;
  field.hidden = hide;
  if (hide) {
    const select = document.getElementById("parent-count");
    if (select && select.value !== "0") select.value = "0";
  }
}

/** 住居手当の「支給あり」選択時に、入力中の家賃から自動計算される金額をヒント表示する */
function updateHousingAmountHint() {
  const hint = document.getElementById("housing-amount-hint");
  if (!hint) return;
  if (radioValue("housing-eligible") !== "1") {
    hint.textContent = "";
    return;
  }
  const rent = Number(document.getElementById("housing-rent").value);
  hint.textContent = `住居手当: ${yen.format(calcHousingAllowance(rent))}`;
}

function updateVisibility() {
  const isGraded = currentTableType() === "graded";
  document.getElementById("grade-field").hidden = !isGraded;
  document.getElementById("housing-amount-field").hidden = radioValue("housing-eligible") !== "1";
  // 指定職俸給表など級のないflat型は「級」の概念がなく、昇給の号俸数目安（標準4/良好6/特に良好8）
  // も級構成を前提にしているため、graded型の俸給表を選んでいる場合のみジャンプボタンを表示する。
  const stepButtons = document.getElementById("step-buttons");
  const stepButtonsHint = document.getElementById("step-buttons-hint");
  if (stepButtons) stepButtons.hidden = !isGraded;
  if (stepButtonsHint) stepButtonsHint.hidden = !isGraded;

  // 指定職職員は扶養手当・住居手当の支給対象外のため、入力欄を隠して代わりに注記を表示する。
  const isDesignated = currentTableKey() === "designated";
  const dependentFields = document.getElementById("dependent-fields");
  const dependentExemptNote = document.getElementById("dependent-exempt-note");
  if (dependentFields) dependentFields.hidden = isDesignated;
  if (dependentExemptNote) dependentExemptNote.hidden = !isDesignated;
  const housingFields = document.getElementById("housing-fields");
  const housingExemptNote = document.getElementById("housing-exempt-note");
  if (housingFields) housingFields.hidden = isDesignated;
  if (housingExemptNote) housingExemptNote.hidden = !isDesignated;

  updateParentCountVisibility();
}

/**
 * 扶養親族数・職務の級・号俸などのボタン選択式カウンター（.counter-btn）を配線する。
 * ボタンは data-target（対象input/selectのid）とdata-delta（増減量）を持つ。
 * 対象がinputでmax属性がある場合はその値を上限としてクランプする（扶養親族数のように
 * max未設定の場合は上限なし）。対象がselect（号俸など）の場合は選択肢の値の最小・最大値を
 * 上限・下限とする。値の変更は対象への"input"イベント発火で通知するため、
 * wireCommonFormEvents()側の再計算・保存ロジックがそのまま動く。
 */
function wireCounterButtons(form) {
  form.querySelectorAll(".counter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      let min;
      let max;
      if (target.tagName === "SELECT") {
        const values = Array.from(target.options).map((o) => Number(o.value));
        min = Math.min(...values);
        max = Math.max(...values);
      } else {
        min = Number(target.min) || 0;
        max = target.max !== "" ? Number(target.max) : Infinity;
      }
      const delta = Number(btn.dataset.delta);
      target.value = Math.min(Math.max((Number(target.value) || 0) + delta, min), max);
      target.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });
}

/** 短縮した説明文の横にある「？」ボタン（.hint-toggle-btn）を押すと、詳細（.hint-detail）を開閉する */
function initHintToggles() {
  document.querySelectorAll(".hint-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const detail = document.getElementById(btn.dataset.target);
      if (!detail) return;
      const willOpen = detail.hidden;
      detail.hidden = !willOpen;
      btn.setAttribute("aria-expanded", String(willOpen));
    });
  });
}

// ---------------------------------------------------------------------------
// 入力内容の保存・復元（localStorage。この端末のブラウザ内のみで完結し、
// サーバーには送信されない）
// ---------------------------------------------------------------------------

function formStorageKey(pageKey) {
  return `salary-calculator:${pageKey}`;
}

/** フォーム内のid付きinput/selectの現在値をlocalStorageに保存する */
function saveFormState(pageKey, form) {
  try {
    const data = {};
    form.querySelectorAll("input[id], select[id]").forEach((el) => {
      // ラジオボタンはグループ内で複数のidを持つため、name をキーにチェック済みの値だけ保存する
      if (el.type === "radio") {
        if (el.checked) data[el.name] = el.value;
        return;
      }
      data[el.id] = el.value;
    });
    localStorage.setItem(formStorageKey(pageKey), JSON.stringify(data));
  } catch {
    // プライベートブラウジング等でlocalStorageが使えない場合は保存をあきらめる
  }
}

/** 保存されている入力値を読み込む。保存がない・読み込めない場合はnullを返す */
function loadFormState(pageKey) {
  try {
    const raw = localStorage.getItem(formStorageKey(pageKey));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** 保存されている入力値を削除する */
function clearFormState(pageKey) {
  try {
    localStorage.removeItem(formStorageKey(pageKey));
  } catch {
    // 何もしない
  }
}

/**
 * 保存済みの値を、対応するフォーム内のinput/selectに反映する。
 * select要素は、保存値が現在の選択肢に存在し、かつ無効化されていない場合のみ反映する
 * （俸給表の切替などで選択肢の構成が変わっている場合があるため）。
 * 俸給表・級・号俸・成績区分など他の項目の選択肢に影響する項目は、
 * 呼び出し側（app.js）で先にpopulate*Options()へ渡して復元してから、
 * この関数で残りの項目をまとめて復元する想定。
 */
function applySavedFormValues(form, saved) {
  if (!saved) return;
  form.querySelectorAll("input[id], select[id]").forEach((el) => {
    if (el.type === "radio") {
      const value = saved[el.name];
      if (value !== undefined) el.checked = el.value === value;
      return;
    }
    const value = saved[el.id];
    if (value === undefined) return;
    if (el.tagName === "SELECT") {
      const hasOption = Array.from(el.options).some((o) => o.value === value && !o.disabled);
      if (hasOption) el.value = value;
    } else {
      el.value = value;
    }
  });
}

/** 俸給の特別調整額の対象（特定管理職員）かどうか */
function isSpecialAdjustmentManager() {
  return radioValue("special-adjustment-type") === "manager";
}

/** 共通の入力項目（期末・勤勉手当や超過勤務時間など固有の項目は含まない） */
function readCommonInput() {
  const grade = Number(document.getElementById("grade").value);
  const tableKey = currentTableKey();
  const honshoEligible = radioValue("honsho-eligible") === "1";
  const housingEligible = radioValue("housing-eligible") === "1";
  const specialAdjustmentCategory = document.getElementById("special-adjustment-category").value;
  return {
    tableKey,
    grade,
    step: Number(document.getElementById("step").value),
    regionalRate: Number(document.getElementById("regional-rate").value),
    childUnder15Count: Number(document.getElementById("child-under15-count").value),
    child16to22Count: Number(document.getElementById("child-16to22-count").value),
    parentCount: Number(document.getElementById("parent-count").value),
    housingAllowance: housingEligible ? calcHousingAllowance(document.getElementById("housing-rent").value) : 0,
    honshoAllowance: honshoEligible ? getHonshoAllowanceAmountForTable(tableKey, grade) : 0,
    specialAdjustmentAllowance: isSpecialAdjustmentManager()
      ? getSpecialAdjustmentAmount(tableKey, grade, specialAdjustmentCategory)
      : 0,
    managementBonusAdditionRate:
      tableKey === "designated"
        ? 0.25
        : isSpecialAdjustmentManager()
          ? getManagementBonusAdditionRate(specialAdjustmentCategory)
          : 0,
  };
}

/** calculateSalary() の結果のうち共通で表示する項目（俸給〜月額支給額合計）を描画する */
function renderCommonResult(result) {
  document.getElementById("r-base").textContent = yen.format(result.baseSalary);
  document.getElementById("r-regional").textContent = yen.format(result.regionalAllowance);
  document.getElementById("r-dependent").textContent = yen.format(result.dependentAllowance);
  document.getElementById("r-housing").textContent = yen.format(result.housingAllowance);
  document.getElementById("r-honsho").textContent = yen.format(result.honshoAllowance);
  document.getElementById("r-special-adjustment").textContent = yen.format(result.specialAdjustmentAllowance);
  document.getElementById("r-monthly-total").textContent = yen.format(result.monthlyTotal);
}

/** 俸給表データが公式データか参考値かを画面上部に表示する */
function updateTableSourceNote() {
  const note = document.getElementById("table-source-note");
  if (!note) return;
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
 * 「俸給表を変えたら級・号俸を再構成する」という共通のイベント配線を行う。
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
      document.getElementById("step").value = "1"; // 俸給表切り替え時は号俸を1にリセットする
      updateTableNote();
    }
    if (e.target.id === "grade") {
      populateStepOptions();
    }
    if (e.target.id === "regional-rate") {
      const municipalitySelect = document.getElementById("regional-municipality");
      if (municipalitySelect && municipalitySelect.value) {
        const location = REGIONAL_ALLOWANCE_LOCATIONS.find((item) => item.code === municipalitySelect.value);
        if (!location || String(location.rate) !== e.target.value) {
          municipalitySelect.value = "";
        }
      }
    }
    if (e.target.name === "regional-input-method") {
      updateRegionalInputMethod();
    }
    updateVisibility();
    updateHonshoAmountHint();
    updateHousingAmountHint();
    updateParentAllowanceHint();
    if (onInputExtra) await onInputExtra(e);
    onRecalculate();
  });

  form.addEventListener("change", async (e) => {
    if (e.target.id === "regional-prefecture") {
      detailedRegionalAllowance.populateMunicipalityOptions();
    }
    if (e.target.id === "regional-municipality") {
      detailedRegionalAllowance.applyMunicipalitySelection();
    }
    updateHonshoAmountHint();
    updateHousingAmountHint();
    updateParentAllowanceHint();
    if (onChangeExtra) await onChangeExtra(e);
    onRecalculate();
  });
}
