/**
 * new-hire.js
 * new-hire.html 固有のDOM配線。共通のフォーム制御・表示ロジックは js/form-controls.js を使う。
 */

function populateBonusRateOptions() {
  ["first-bonus-rate", "second-bonus-rate"].forEach((id) => {
    const select = document.getElementById(id);
    select.innerHTML = "";
    BONUS_PERIOD_RATES.forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r.value;
      opt.textContent = r.label;
      select.appendChild(opt);
    });
  });
  // 新規採用者の典型例：1回目は在職期間が短い（3か月未満=期間率0.3）、2回目は満額を既定値とする
  document.getElementById("first-bonus-rate").value = "0.3";
  document.getElementById("second-bonus-rate").value = "1";
}

function recalculate() {
  const input = {
    ...readCommonInput(),
    weekdayNormalHours: 0,
    weekdayNightHours: 0,
    holidayNormalHours: 0,
    holidayNightHours: 0,
  };
  const result = calculateSalary(input);

  const firstRate = Number(document.getElementById("first-bonus-rate").value);
  const secondRate = Number(document.getElementById("second-bonus-rate").value);
  const firstBonus = calculateBonusWithPeriodRate(result.bonusBase, input.bonusMonths, firstRate);
  const secondBonus = calculateBonusWithPeriodRate(result.bonusBase, input.bonusMonths, secondRate);
  const annualIncome = result.monthlyTotal * 12 + firstBonus + secondBonus;

  renderCommonResult(result);
  document.getElementById("r-bonus-first").textContent = yen.format(firstBonus);
  document.getElementById("r-bonus-second").textContent = yen.format(secondBonus);
  document.getElementById("r-annual").textContent = yen.format(annualIncome);
}

function initForm() {
  populateSalaryTableOptions("administrative_1");
  populateGradeOptions("1");
  populateStepOptions();
  populateRegionalRateOptions();
  populateBonusRateOptions();
  updateVisibility();

  const form = document.getElementById("calc-form");
  wireCommonFormEvents(form, { onRecalculate: recalculate });

  recalculate();
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadOfficialSalaryTable();
  updateTableSourceNote();
  initForm();
});
