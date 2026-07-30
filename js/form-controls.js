/**
 * form-controls.js
 * index.html / new-hire.html の両方で使う共通のフォーム制御・表示ロジック。
 * 両ページで一致しているDOM ID（salary-table, grade, grade-field, step,
 * regional-rate, regional-rate-table-body, child-under15-count, child-16to22-count,
 * parent-count, housing-eligible, housing-amount-field, housing-allowance,
 * honsho-eligible, honsho-amount-hint, honsho-reference-table-body,
 * table-source-note, r-base, r-regional, r-dependent, r-housing, r-honsho,
 * r-monthly-total）を前提にする。
 * 期末・勤勉手当の入力（index.htmlは成績率区分、new-hire.htmlは在職期間率）は
 * ページごとに構成が異なるため、それぞれ js/app.js / js/new-hire.js 側で扱う。
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
  const stepSelect = document.getElementById("step");
  const currentValue = Number(stepSelect.value) || 1;
  const maxStep = getMaxStep(tableKey, grade);
  const newValue = Math.min(Math.max(currentValue, 1), maxStep);
  stepSelect.innerHTML = "";
  for (let s = 1; s <= maxStep; s++) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = `${s}号俸`;
    stepSelect.appendChild(opt);
  }
  stepSelect.value = newValue;
}

function regionalRateLabel(r) {
  const percent = `${(r.value * 100).toFixed(0)}%`;
  return `${r.name}（${percent}）${r.example ? `例：${r.example}` : ""}`;
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
}

/** 地域手当の級地区分ごとの支給割合を一覧表（折りたたみ）に描画する */
function populateRegionalRateTable() {
  const tbody = document.getElementById("regional-rate-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";
  REGIONAL_ALLOWANCE_RATES.forEach((r) => {
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    nameTd.textContent = r.name;
    const rateTd = document.createElement("td");
    rateTd.textContent = `${(r.value * 100).toFixed(0)}%`;
    const exampleTd = document.createElement("td");
    exampleTd.textContent = r.example || "-";
    tr.appendChild(nameTd);
    tr.appendChild(rateTd);
    tr.appendChild(exampleTd);
    tbody.appendChild(tr);
  });
}

/** 本府省業務調整手当（本省手当）の級別参考額を一覧表（折りたたみ）に描画する */
function populateHonshoReferenceTable() {
  const tbody = document.getElementById("honsho-reference-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";
  HONSHO_ALLOWANCE_REFERENCE.forEach((r) => {
    const tr = document.createElement("tr");
    const gradeTd = document.createElement("td");
    gradeTd.textContent = r.grade;
    const amountTd = document.createElement("td");
    amountTd.textContent = yen.format(r.amount);
    tr.appendChild(gradeTd);
    tr.appendChild(amountTd);
    tbody.appendChild(tr);
  });
}

/** 本省手当の「支給あり」選択時に、現在の級から自動計算される参考額をヒント表示する */
function updateHonshoAmountHint() {
  const hint = document.getElementById("honsho-amount-hint");
  const eligibleSelect = document.getElementById("honsho-eligible");
  if (!hint || !eligibleSelect) return;
  if (eligibleSelect.value !== "1") {
    hint.textContent = "";
    return;
  }
  const grade = Number(document.getElementById("grade").value);
  const amount = getHonshoAllowanceAmount(grade);
  if (amount > 0) {
    const gradeLabel = grade >= 7 ? `${grade}級（7級以上）` : `${grade}級`;
    hint.textContent = `${gradeLabel}の参考額: ${yen.format(amount)}（要確認）`;
  } else {
    hint.textContent = "職務の級が取得できないため自動計算できません（¥0として扱われます）。";
  }
}

function updateVisibility() {
  document.getElementById("grade-field").hidden = currentTableType() !== "graded";
  document.getElementById("housing-amount-field").hidden =
    document.getElementById("housing-eligible").value !== "1";
}

/**
 * 扶養親族数などのボタン選択式カウンター（.counter-btn）を配線する。
 * ボタンは data-target（対象inputのid）とdata-delta（増減量）を持つ。
 * 値の変更は対象inputへの"input"イベント発火で通知するため、
 * wireCommonFormEvents()側の再計算・保存ロジックがそのまま動く。
 */
function wireCounterButtons(form) {
  form.querySelectorAll(".counter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      const min = Number(target.min) || 0;
      const delta = Number(btn.dataset.delta);
      target.value = Math.max((Number(target.value) || 0) + delta, min);
      target.dispatchEvent(new Event("input", { bubbles: true }));
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
 * 呼び出し側（app.js / new-hire.js）で先にpopulate*Options()へ渡して復元してから、
 * この関数で残りの項目をまとめて復元する想定。
 */
function applySavedFormValues(form, saved) {
  if (!saved) return;
  form.querySelectorAll("input[id], select[id]").forEach((el) => {
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

/** 両ページ共通の入力項目（期末・勤勉手当や超過勤務時間などページ固有の項目は含まない） */
function readCommonInput() {
  const grade = Number(document.getElementById("grade").value);
  const honshoEligible = document.getElementById("honsho-eligible").value === "1";
  const housingEligible = document.getElementById("housing-eligible").value === "1";
  return {
    tableKey: currentTableKey(),
    grade,
    step: Number(document.getElementById("step").value),
    regionalRate: Number(document.getElementById("regional-rate").value),
    childUnder15Count: Number(document.getElementById("child-under15-count").value),
    child16to22Count: Number(document.getElementById("child-16to22-count").value),
    parentCount: Number(document.getElementById("parent-count").value),
    housingAllowance: housingEligible ? Number(document.getElementById("housing-allowance").value) : 0,
    honshoAllowance: honshoEligible ? getHonshoAllowanceAmount(grade) : 0,
  };
}

/** calculateSalary() の結果のうち両ページ共通で表示する項目（俸給〜月額支給額合計）を描画する */
function renderCommonResult(result) {
  document.getElementById("r-base").textContent = yen.format(result.baseSalary);
  document.getElementById("r-regional").textContent = yen.format(result.regionalAllowance);
  document.getElementById("r-dependent").textContent = yen.format(result.dependentAllowance);
  document.getElementById("r-housing").textContent = yen.format(result.housingAllowance);
  document.getElementById("r-honsho").textContent = yen.format(result.honshoAllowance);
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
 * 「俸給表を変えたら級・号俸を再構成する」という両ページ共通のイベント配線を行う。
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
    }
    if (e.target.id === "grade") {
      populateStepOptions();
    }
    updateVisibility();
    updateHonshoAmountHint();
    if (onInputExtra) await onInputExtra(e);
    onRecalculate();
  });

  form.addEventListener("change", async (e) => {
    updateHonshoAmountHint();
    if (onChangeExtra) await onChangeExtra(e);
    onRecalculate();
  });
}
