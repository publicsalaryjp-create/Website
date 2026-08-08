(function () {
  "use strict";

  const TERM_MONTHS = {
    general: 1.2625,
    senior_manager: 1.0625,
    designated: 0.675,
  };
  const form = document.getElementById("merit-rate-form");
  const salaryTableInput = document.getElementById("salary-table-type");
  const staffTypeField = document.getElementById("staff-type-field");
  const termInput = document.getElementById("term-amount");
  const meritInput = document.getElementById("merit-amount");
  const emptyResult = document.getElementById("empty-result");
  const calculatedResult = document.getElementById("calculated-result");
  const dependentBaseInput = document.getElementById("dependent-base-addition");
  const regionalPrefectureInput = document.getElementById("regional-prefecture");
  const regionalMunicipalityInput = document.getElementById("regional-municipality");
  const regionalRateInput = document.getElementById("regional-rate");
  const regionalLocationInputs = document.getElementById("regional-location-inputs");
  const regionalRateField = document.getElementById("regional-rate-input");
  const regionalRateStatus = document.getElementById("regional-rate-status");
  const STORAGE_KEY = "salary-calculator:kinben-seisekiritsu";

  const MERIT_CATEGORIES = {
    general: { notGoodMax: 93.75, good: 102.25, excellentMin: 113.75, excellentPlusMin: 125.25, max: 318.75 },
    senior_manager: { notGoodMax: 112.75, good: 122.25, excellentMin: 134.75, excellentPlusMin: 149.25, max: 378.75 },
    designated: { notGoodMax: 93, good: 101.5, excellentMin: 115, excellentPlusMin: null, max: 215 },
  };

  function parseAmount(value) {
    const normalized = String(value).replace(/[０-９]/g, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - 0xfee0)
    );
    const digits = normalized.replace(/[,，\s円]/g, "");
    if (!/^\d+$/.test(digits)) return NaN;
    return Number(digits);
  }

  function formatInput(input) {
    const amount = parseAmount(input.value);
    if (Number.isFinite(amount)) input.value = amount.toLocaleString("ja-JP");
  }

  function saveFormState() {
    try {
      const data = {};
      form.querySelectorAll("input, select").forEach((input) => {
        const key = input.id || input.name;
        if (!key || (input.type === "radio" && !input.checked)) return;
        data[input.type === "radio" ? input.name : key] = input.value;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // localStorageを使用できない環境では保存しない。
    }
  }

  function restoreFormState() {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    } catch {
      return;
    }
    if (!saved) return;

    const applyValue = (input) => {
      const key = input.type === "radio" ? input.name : input.id || input.name;
      const value = saved[key];
      if (value === undefined) return;
      if (input.type === "radio") {
        input.checked = input.value === value;
      } else if (input.tagName === "SELECT") {
        if (Array.from(input.options).some((option) => option.value === value && !option.disabled)) {
          input.value = value;
        }
      } else {
        input.value = value;
      }
    };

    form.querySelectorAll("input, select").forEach((input) => {
      if (input !== regionalMunicipalityInput) applyValue(input);
    });
    populateMunicipalities();
    applyValue(regionalMunicipalityInput);
    // 市区町村の復元で地域手当率を上書きせず、保存した直接選択値を優先する。
    applyValue(regionalRateInput);
    staffTypeField.hidden = salaryTableInput.value !== "administrative_1";
    updateRegionalInputMethod();
  }

  function showError(input, message) {
    const describedBy = input.getAttribute("aria-describedby");
    const error = describedBy
      ? document.getElementById(describedBy.split(" ").pop())
      : document.getElementById(`${input.id}-error`);
    input.setAttribute("aria-invalid", message ? "true" : "false");
    if (error) error.textContent = message;
  }

  function classifyMeritRate(rate, staffType) {
    const category = MERIT_CATEGORIES[staffType];
    const rounded = Number(rate.toFixed(2));
    if (rounded > category.max) return "基準上限を超過";
    if (category.excellentPlusMin !== null && rounded >= category.excellentPlusMin) return "特に優秀";
    if (rounded >= category.excellentMin) return "優秀";
    if (Math.abs(rounded - category.good) < 0.011) return "良好";
    if (rounded <= category.notGoodMax) return "良好でない";
    return "区分を特定できません";
  }

  function regionalRateLabel(rate) {
    return rate === 0 ? "0%（非支給地）" : `${Math.round(rate * 100)}%`;
  }

  function populateRegionalInputs() {
    const prefectures = [...new Set(REGIONAL_ALLOWANCE_LOCATIONS.map((location) => location.prefecture))];
    regionalPrefectureInput.innerHTML = '<option value="">都道府県を選ぶ</option>';
    prefectures.forEach((prefecture) => {
      regionalPrefectureInput.add(new Option(prefecture, prefecture));
    });

    const rates = [...new Set(REGIONAL_ALLOWANCE_LOCATIONS.map((location) => location.rate))]
      .sort((a, b) => b - a);
    regionalRateInput.innerHTML = "";
    rates.forEach((rate) => {
      regionalRateInput.add(new Option(regionalRateLabel(rate), String(rate)));
    });
    regionalRateInput.value = "0";
    populateMunicipalities();
  }

  function populateMunicipalities() {
    const locations = REGIONAL_ALLOWANCE_LOCATIONS.filter(
      (location) => location.prefecture === regionalPrefectureInput.value
    );
    regionalMunicipalityInput.innerHTML = `<option value="">${locations.length ? "市区町村等を選ぶ" : "先に都道府県を選ぶ"}</option>`;
    locations.forEach((location) => {
      regionalMunicipalityInput.add(new Option(location.municipality, location.code));
    });
    regionalMunicipalityInput.disabled = locations.length === 0;
  }

  function updateRegionalRateStatus() {
    if (!regionalMunicipalityInput.value) {
      regionalRateStatus.textContent = "市区町村を選ぶと、支給割合が自動で設定されます。";
      regionalRateStatus.classList.remove("is-selected");
      return;
    }
    regionalRateStatus.textContent = `設定された支給割合: ${regionalRateLabel(Number(regionalRateInput.value))}`;
    regionalRateStatus.classList.add("is-selected");
  }

  function updateRegionalInputMethod() {
    const useLocation = form.elements["regional-input-method"].value !== "rate";
    regionalLocationInputs.hidden = !useLocation;
    regionalRateField.hidden = useLocation;
  }

  function calculate(event) {
    event.preventDefault();
    const termAmount = parseAmount(termInput.value);
    const meritAmount = parseAmount(meritInput.value);
    const dependentAllowance = parseAmount(dependentBaseInput.value);
    const regionalRate = Number(regionalRateInput.value);
    const termValid = Number.isFinite(termAmount) && termAmount > 0;
    const meritValid = Number.isFinite(meritAmount) && meritAmount >= 0;
    const dependentBaseValid = Number.isFinite(dependentAllowance) && dependentAllowance >= 0;

    showError(termInput, termValid ? "" : "1円以上の期末手当を入力してください。" );
    showError(meritInput, meritValid ? "" : "0円以上の勤勉手当を入力してください。" );
    showError(dependentBaseInput, dependentBaseValid ? "" : "0円以上の加算額を入力してください。" );
    if (!termValid || !meritValid || !dependentBaseValid) return;

    formatInput(termInput);
    formatInput(meritInput);
    formatInput(dependentBaseInput);

    const staffType = salaryTableInput.value === "designated"
      ? "designated"
      : form.elements["staff-type"].value;
    const termMonths = TERM_MONTHS[staffType];
    const estimatedTermBase = termAmount / termMonths;
    const dependentRegionalAllowance = Math.floor(dependentAllowance * regionalRate);
    const dependentBaseAddition = dependentAllowance + dependentRegionalAllowance;
    const estimatedMeritBase = estimatedTermBase - dependentBaseAddition;
    if (estimatedMeritBase <= 0) {
      showError(dependentBaseInput, "期末手当から推定される算定基礎額より小さい金額を入力してください。" );
      return;
    }
    const meritRate = (meritAmount / estimatedMeritBase) * 100;

    document.getElementById("result-rate").textContent = meritRate.toFixed(2);
    document.getElementById("result-category").textContent = classifyMeritRate(meritRate, staffType);
    document.getElementById("result-base").textContent = `${Math.round(estimatedMeritBase).toLocaleString("ja-JP")}円`;
    document.getElementById("result-formula").textContent =
      `${meritAmount.toLocaleString("ja-JP")}円 ÷ (${termAmount.toLocaleString("ja-JP")}円 ÷ ${termMonths}月 − ${dependentAllowance.toLocaleString("ja-JP")}円 − ${dependentRegionalAllowance.toLocaleString("ja-JP")}円)`;
    emptyResult.hidden = true;
    calculatedResult.hidden = false;
    saveFormState();
  }

  [termInput, meritInput, dependentBaseInput].forEach((input) => {
    input.addEventListener("blur", () => formatInput(input));
    input.addEventListener("input", () => showError(input, ""));
  });

  function resetResult() {
    emptyResult.hidden = false;
    calculatedResult.hidden = true;
  }

  salaryTableInput.addEventListener("change", () => {
    staffTypeField.hidden = salaryTableInput.value !== "administrative_1";
    resetResult();
  });
  form.querySelectorAll('input[name="staff-type"]').forEach((input) => {
    input.addEventListener("change", resetResult);
  });
  form.querySelectorAll('input[name="payment-period"]').forEach((input) => {
    input.addEventListener("change", resetResult);
  });
  form.querySelectorAll('input[name="regional-input-method"]').forEach((input) => {
    input.addEventListener("change", () => {
      updateRegionalInputMethod();
      resetResult();
    });
  });
  regionalPrefectureInput.addEventListener("change", () => {
    populateMunicipalities();
    updateRegionalRateStatus();
    resetResult();
  });
  regionalMunicipalityInput.addEventListener("change", () => {
    const location = REGIONAL_ALLOWANCE_LOCATIONS.find(
      (item) => item.code === regionalMunicipalityInput.value
    );
    if (location) regionalRateInput.value = String(location.rate);
    updateRegionalRateStatus();
    resetResult();
  });
  regionalRateInput.addEventListener("change", () => {
    const location = REGIONAL_ALLOWANCE_LOCATIONS.find(
      (item) => item.code === regionalMunicipalityInput.value
    );
    if (location && String(location.rate) !== regionalRateInput.value) {
      regionalMunicipalityInput.value = "";
    }
    updateRegionalRateStatus();
    resetResult();
  });

  form.addEventListener("input", saveFormState);
  form.addEventListener("change", saveFormState);
  form.addEventListener("focusout", saveFormState);

  populateRegionalInputs();
  restoreFormState();
  updateRegionalInputMethod();
  updateRegionalRateStatus();

  form.addEventListener("submit", calculate);
})();
