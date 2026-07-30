/**
 * index.html / new-hire.html を実際にブラウザで開き、コンソールエラーが出ないことと
 * 代表的な計算結果が期待通りであることを確認するスモークテスト。
 * python等に依存しないよう、Node組み込みのhttpサーバーを内部で起動する。
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function startServer() {
  const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const filePath = path.join(root, urlPath === "/" ? "/index.html" : urlPath);
    try {
      const data = await readFile(filePath);
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

let failed = 0;
function report(name, ok, detail) {
  if (ok) {
    console.log(`ok - ${name}`);
  } else {
    failed++;
    console.error(`FAIL - ${name}${detail ? `\n    ${detail}` : ""}`);
  }
}

const server = await startServer();
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch();

// 職務の級・号俸はボタン選択式のreadonly数値入力になっているため、
// page.fill()の代わりにこの関数で値を直接設定する（実際のボタン操作の検証は別テストで行う）。
async function setReadonlyNumber(page, selector, value) {
  await page.evaluate(
    ({ selector, value }) => {
      const el = document.querySelector(selector);
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { selector, value }
  );
}

async function checkNoConsoleErrors(pathName, label) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(`${base}${pathName}`);
  await page.waitForTimeout(500);
  // favicon.ico の404はブラウザが自動リクエストするノイズなので無視する
  const realErrors = errors.filter((e) => !e.includes("favicon"));
  report(label, realErrors.length === 0, realErrors.join("\n    "));
  await page.close();
}

await checkNoConsoleErrors("/index.html", "index.html: コンソールエラーなしで読み込める");
await checkNoConsoleErrors("/new-hire.html", "new-hire.html: コンソールエラーなしで読み込める");

// index.html: 代表的な計算結果の妥当性
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#salary-table", "administrative_1");
  await page.selectOption("#regional-rate", "0");
  await page.waitForTimeout(300);
  const baseSalaryText = await page.textContent("#r-base");
  const baseSalary = Number(baseSalaryText.replace(/[^\d]/g, ""));
  try {
    assert.ok(baseSalary > 0, `俸給月額が0以下: ${baseSalaryText}`);
    report("index.html: 行政職(一) 1級1号俸の俸給月額が正の値", true);
  } catch (e) {
    report("index.html: 行政職(一) 1級1号俸の俸給月額が正の値", false, e.message);
  }
  await page.close();
}

// index.html: flat型俸給表（指定職）を選ぶと級の入力欄が隠れ、俸給月額が正の値になる
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#salary-table", "designated");
  await page.waitForTimeout(300);
  const gradeFieldHidden = await page.isHidden("#grade-field");
  const baseSalaryText = await page.textContent("#r-base");
  const baseSalary = Number(baseSalaryText.replace(/[^\d]/g, ""));
  report(
    "index.html: 指定職俸給表（flat型）で級の入力欄が隠れ、俸給月額が正の値になる",
    gradeFieldHidden && baseSalary > 0,
    `grade-field非表示=${gradeFieldHidden} 俸給月額=${baseSalaryText}`
  );
  await page.close();
}

// index.html: 行政職以外の俸給表（graded型、医療職俸給表(一)）でも俸給月額が正の値になる
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#salary-table", "medical_1");
  await page.waitForTimeout(300);
  const baseSalaryText = await page.textContent("#r-base");
  const baseSalary = Number(baseSalaryText.replace(/[^\d]/g, ""));
  report(
    "index.html: 医療職俸給表(一) 1級1号俸の俸給月額が正の値",
    baseSalary > 0,
    `俸給月額=${baseSalaryText}`
  );
  await page.close();
}

// index.html: 扶養手当が15歳以下/16〜22歳/父母等の区分ごとに正しく合算される
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#salary-table", "administrative_1");
  await page.selectOption("#regional-rate", "0");
  await page.click('.counter-btn[data-target="child-under15-count"][data-delta="1"]');
  await page.click('.counter-btn[data-target="child-16to22-count"][data-delta="1"]');
  await page.click('.counter-btn[data-target="parent-count"][data-delta="1"]');
  await page.waitForTimeout(300);
  const dependentText = await page.textContent("#r-dependent");
  report(
    "index.html: 扶養手当が15歳以下13,000+16〜22歳18,000+父母等6,500=37,500円",
    dependentText.includes("37,500"),
    `実際の表示: ${dependentText}`
  );
  await page.close();
}

// index.html: 生涯賃金シミュレーションの自動生成が動く
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.fill("#lifetime-years", "3");
  await page.click("#lifetime-autofill");
  await page.waitForTimeout(300);
  const rowCount = await page.$$eval("#lifetime-tbody tr", (trs) => trs.length);
  report("index.html: 生涯賃金シミュレーションが3行生成される", rowCount === 3, `実際の行数: ${rowCount}`);
  await page.close();
}

// new-hire.html: 期間率を反映した賞与が計算される
{
  const page = await browser.newPage();
  await page.goto(`${base}/new-hire.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#first-bonus-rate", "1");
  await page.selectOption("#second-bonus-rate", "1");
  await page.waitForTimeout(300);
  const first = await page.textContent("#r-bonus-first");
  const second = await page.textContent("#r-bonus-second");
  report("new-hire.html: 期間率1.0のとき1回目と2回目の賞与が一致する", first === second, `${first} vs ${second}`);
  await page.close();
}

// new-hire.html: 既定値が新規採用者の典型例（1級1号俸、1回目0.3・2回目1.0）になっている
{
  const page = await browser.newPage();
  await page.goto(`${base}/new-hire.html`);
  await page.waitForTimeout(500);
  const grade = await page.$eval("#grade", (el) => el.value);
  const firstRate = await page.$eval("#first-bonus-rate", (el) => el.value);
  const secondRate = await page.$eval("#second-bonus-rate", (el) => el.value);
  report(
    "new-hire.html: 既定値が1級・1回目期間率0.3・2回目期間率1.0",
    grade === "1" && firstRate === "0.3" && secondRate === "1",
    `grade=${grade} first=${firstRate} second=${secondRate}`
  );
  await page.close();
}

// index.html: 号俸の昇給ボタン（+4/+6/+8, -4/-6/-8）が正しく増減する
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await setReadonlyNumber(page, "#step", "10");
  await page.click('.step-btn[data-delta="4"]');
  await page.waitForTimeout(150);
  const afterPlus4 = await page.inputValue("#step");
  await page.click('.step-btn[data-delta="-6"]');
  await page.waitForTimeout(150);
  const afterMinus6 = await page.inputValue("#step");
  report(
    "index.html: 号俸ボタンで10→+4→-6が正しく反映される(期待値: 14→8)",
    afterPlus4 === "14" && afterMinus6 === "8",
    `+4後=${afterPlus4} -6後=${afterMinus6}`
  );
  await page.close();
}

// index.html: 住居手当は既定「支給なし」で0円、「支給あり」にすると家賃の半額(28,000円未満)が反映される
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  const defaultEligible = await page.inputValue("#housing-eligible");
  const defaultHousingText = await page.textContent("#r-housing");
  const amountFieldHiddenByDefault = await page.isHidden("#housing-amount-field");
  await page.selectOption("#housing-eligible", "1");
  await page.fill("#housing-rent", "15000");
  await page.waitForTimeout(200);
  const housingText = await page.textContent("#r-housing");
  const hintText = await page.textContent("#housing-amount-hint");
  report(
    "index.html: 住居手当は既定で支給なし(0円、金額欄は非表示)、支給ありで家賃15,000円なら半額の7,500円が反映される",
    defaultEligible === "0" &&
      defaultHousingText.includes("0") &&
      amountFieldHiddenByDefault &&
      housingText.includes("7,500") &&
      hintText.includes("7,500"),
    `既定=${defaultEligible}/${defaultHousingText}/非表示=${amountFieldHiddenByDefault} 支給あり後=${housingText} ヒント=${hintText}`
  );
  await page.close();
}

// index.html: 家賃が高額でも住居手当は28,000円が上限になる
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#housing-eligible", "1");
  await page.fill("#housing-rent", "100000");
  await page.waitForTimeout(200);
  const housingText = await page.textContent("#r-housing");
  report(
    "index.html: 家賃100,000円（半額50,000円）でも住居手当は上限の28,000円になる",
    housingText.includes("28,000"),
    `表示=${housingText}`
  );
  await page.close();
}

// index.html: 住居手当を「支給あり」にして家賃を入れても、「支給なし」に戻すと0円になる（持ち家扱い）
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#housing-eligible", "1");
  await page.fill("#housing-rent", "20000");
  await page.waitForTimeout(200);
  await page.selectOption("#housing-eligible", "0");
  await page.waitForTimeout(200);
  const housingText = await page.textContent("#r-housing");
  const amountFieldHidden = await page.isHidden("#housing-amount-field");
  report(
    "index.html: 住居手当を支給ありから支給なしに戻すと、家賃を入力していても0円になる",
    housingText.includes("0") && !housingText.includes("10,000") && amountFieldHidden,
    `表示=${housingText} 非表示=${amountFieldHidden}`
  );
  await page.close();
}

// index.html: 本省手当は既定「支給なし」で0円、「支給あり」にすると級から自動計算される
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  const defaultChecked = await page.isChecked("#honsho-eligible-no");
  const defaultHonshoText = await page.textContent("#r-honsho");
  await page.selectOption("#salary-table", "administrative_1");
  await setReadonlyNumber(page, "#grade", "3");
  await page.check("#honsho-eligible-yes");
  await page.waitForTimeout(200);
  const honshoText = await page.textContent("#r-honsho");
  const hintText = await page.textContent("#honsho-amount-hint");
  report(
    "index.html: 本省手当は既定で支給なし(0円)、支給ありにすると3級の参考額(19,500円)が自動反映され、ヒントも表示される",
    defaultChecked &&
      defaultHonshoText.includes("0") &&
      honshoText.includes("19,500") &&
      hintText.includes("19,500"),
    `既定チェック=${defaultChecked}/${defaultHonshoText} 支給あり=${honshoText} ヒント=${hintText}`
  );
  await page.close();
}

// index.html: 勤務成績区分を変えると勤勉手当（6月期）が変わる（一般職員: 良好→特に優秀）
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#salary-table", "administrative_1");
  await page.selectOption("#regional-rate", "0");
  await page.selectOption("#merit-staff-type-june", "general");
  await page.selectOption("#merit-grade-june", "good");
  await page.waitForTimeout(200);
  const kinbenGood = await page.textContent("#r-kinben-june");
  const teishuGood = await page.textContent("#r-teishu-june");
  await page.selectOption("#merit-grade-june", "excellent_plus");
  await page.waitForTimeout(200);
  const kinbenExcellentPlus = await page.textContent("#r-kinben-june");
  const teishuExcellentPlus = await page.textContent("#r-teishu-june");
  report(
    "index.html: 成績区分を「良好」→「特に優秀」に変えると勤勉手当が増え、期末手当は変わらない",
    kinbenExcellentPlus !== kinbenGood && teishuExcellentPlus === teishuGood,
    `勤勉(良好)=${kinbenGood} 勤勉(特に優秀)=${kinbenExcellentPlus} 期末(良好)=${teishuGood} 期末(特に優秀)=${teishuExcellentPlus}`
  );
  await page.close();
}

// index.html: 指定職職員では「特に優秀」の選択肢が存在しない
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#merit-staff-type-june", "designated");
  await page.waitForTimeout(200);
  const gradeOptions = await page.$$eval("#merit-grade-june option", (opts) => opts.map((o) => o.value));
  report(
    "index.html: 指定職職員には「特に優秀」の選択肢がない",
    !gradeOptions.includes("excellent_plus"),
    `選択肢: ${JSON.stringify(gradeOptions)}`
  );
  await page.close();
}

// index.html: 勤勉手当は6月期・12月期で別々に職員区分・成績区分を設定できる
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#salary-table", "administrative_1");
  await page.selectOption("#regional-rate", "0");
  await page.selectOption("#merit-staff-type-june", "general");
  await page.selectOption("#merit-grade-june", "excellent_plus");
  await page.selectOption("#merit-staff-type-december", "general");
  await page.selectOption("#merit-grade-december", "not_good");
  await page.waitForTimeout(200);
  const kinbenJune = await page.textContent("#r-kinben-june");
  const kinbenDecember = await page.textContent("#r-kinben-december");
  const teishuJune = await page.textContent("#r-teishu-june");
  const teishuDecember = await page.textContent("#r-teishu-december");
  report(
    "index.html: 6月期「特に優秀」・12月期「良好でない」で勤勉手当が期ごとに異なり、期末手当は変わらない",
    kinbenJune !== kinbenDecember && teishuJune === teishuDecember,
    `勤勉(6月)=${kinbenJune} 勤勉(12月)=${kinbenDecember} 期末(6月)=${teishuJune} 期末(12月)=${teishuDecember}`
  );
  await page.close();
}

// index.html: 扶養親族数のボタンで増減し、0未満にはならない
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.click('.counter-btn[data-target="parent-count"][data-delta="-1"]');
  await page.waitForTimeout(150);
  const afterDecrementAtZero = await page.inputValue("#parent-count");
  await page.click('.counter-btn[data-target="parent-count"][data-delta="1"]');
  await page.click('.counter-btn[data-target="parent-count"][data-delta="1"]');
  await page.waitForTimeout(150);
  const afterTwoIncrements = await page.inputValue("#parent-count");
  report(
    "index.html: 扶養親族数ボタンは0未満にならず、+1を2回押すと2になる",
    afterDecrementAtZero === "0" && afterTwoIncrements === "2",
    `-1後=${afterDecrementAtZero} +1×2後=${afterTwoIncrements}`
  );
  await page.close();
}

// index.html: 俸給表バージョンのプルダウンで「現行」が選択可能・「人事院勧告後」は選択不可
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  const options = await page.$$eval("#salary-vintage option", (opts) =>
    opts.map((o) => ({ value: o.value, disabled: o.disabled }))
  );
  const current = options.find((o) => o.value === "current");
  const postRecommendation = options.find((o) => o.value === "post_recommendation");
  report(
    "index.html: 俸給表バージョンは現行のみ選択可能、人事院勧告後は選択不可",
    current && !current.disabled && postRecommendation && postRecommendation.disabled,
    JSON.stringify(options)
  );
  await page.close();
}

// index.html: 地域手当の級地区分ごとの支給割合表が折りたたみ内に描画され、開閉できる
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  const rowCount = await page.$$eval("#regional-rate-table-body tr", (trs) => trs.length);
  const isOpenBefore = await page.$eval(".regional-rate-details", (el) => el.open);
  await page.click(".regional-rate-details summary");
  await page.waitForTimeout(150);
  const isOpenAfter = await page.$eval(".regional-rate-details", (el) => el.open);
  report(
    "index.html: 地域手当の割合表が6区分描画され、クリックで開閉できる",
    rowCount === 6 && isOpenBefore === false && isOpenAfter === true,
    `行数=${rowCount} 開閉前=${isOpenBefore} 開閉後=${isOpenAfter}`
  );
  await page.close();
}

// index.html: 地域名から選ぶと級地区分プルダウンに反映され、直接変更すると地域名選択が解除される
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#regional-rate-region", "東京都特別区（23区）");
  await page.waitForTimeout(150);
  const rateAfterRegion = await page.inputValue("#regional-rate");
  await page.selectOption("#regional-rate", "0");
  await page.waitForTimeout(150);
  const regionAfterManualChange = await page.inputValue("#regional-rate-region");
  report(
    "index.html: 地域名から選ぶと級地区分(1級地=0.2)に反映され、直接変更すると地域名選択が解除される",
    rateAfterRegion === "0.2" && regionAfterManualChange === "",
    `regional-rate(選択後)=${rateAfterRegion} regional-rate-region(手動変更後)=${regionAfterManualChange}`
  );
  await page.close();
}

// index.html: 入力内容がlocalStorageに保存され、リロード後も復元される
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#housing-eligible", "1");
  await page.fill("#housing-rent", "23000");
  await page.selectOption("#regional-rate", "0.12");
  await page.waitForTimeout(200);
  await page.reload();
  await page.waitForTimeout(500);
  const housingEligibleValue = await page.inputValue("#housing-eligible");
  const housingValue = await page.inputValue("#housing-rent");
  const regionalValue = await page.inputValue("#regional-rate");
  report(
    "index.html: 入力内容がリロード後も復元される",
    housingEligibleValue === "1" && housingValue === "23000" && regionalValue === "0.12",
    `housing-eligible=${housingEligibleValue} housing=${housingValue} regional=${regionalValue}`
  );
  await page.close();
}

// index.html: 「保存した入力内容を削除」ボタンで初期状態に戻る
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#housing-eligible", "1");
  await page.fill("#housing-rent", "23000");
  await page.waitForTimeout(200);
  await page.click("#reset-saved-input");
  await page.waitForTimeout(500);
  const housingEligibleValue = await page.inputValue("#housing-eligible");
  report(
    "index.html: 保存データ削除ボタンで住居手当が初期値（支給なし）に戻る",
    housingEligibleValue === "0",
    `housing-eligible=${housingEligibleValue}`
  );
  await page.close();
}

// new-hire.html: 入力内容がリロード後も復元される
{
  const page = await browser.newPage();
  await page.goto(`${base}/new-hire.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#housing-eligible", "1");
  await page.fill("#housing-rent", "8000");
  await page.waitForTimeout(200);
  await page.reload();
  await page.waitForTimeout(500);
  const housingValue = await page.inputValue("#housing-rent");
  report(
    "new-hire.html: 入力内容がリロード後も復元される",
    housingValue === "8000",
    `housing=${housingValue}`
  );
  await page.close();
}

await browser.close();
await new Promise((resolve) => server.close(resolve));

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nすべてのE2Eチェックに合格しました");
