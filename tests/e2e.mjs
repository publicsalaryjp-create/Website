/**
 * index.html を実際にブラウザで開き、コンソールエラーが出ないことと
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

async function setRegionalRate(page, value) {
  await page.check("#regional-input-method-rate");
  await page.selectOption("#regional-rate", value);
}

async function selectMeritGrade(page, period, value) {
  await page.check(`input[name="merit-grade-${period}"][value="${value}"]`);
}

// index.htmlの既定タブは「かんたんモード」なので、詳細フォーム(#calc-form)の項目を
// 直接操作するテストは、先にこれで「本格計算モード」タブへ切り替えてから操作する。
async function goToDetailedTab(page) {
  await page.click("#tab-detailed");
  await page.waitForTimeout(150);
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

await checkNoConsoleErrors(
  "/kinben-seisekiritsu/index.html",
  "kinben-seisekiritsu: コンソールエラーなしで読み込める"
);

{
  const page = await browser.newPage();
  await page.goto(`${base}/kinben-seisekiritsu/index.html`);
  const disclaimerText = await page.textContent("#disclaimer");
  report(
    "kinben-seisekiritsu: 免責事項が表示される",
    disclaimerText.includes("計算結果の正確性を保証するものではありません") &&
      disclaimerText.includes("運営者は一切責任を負いません"),
    disclaimerText
  );
  await page.close();
}

// 成績率逆算: 管理職三種は一般職員として今回の支給額から良好102.25%を逆算できる
{
  const page = await browser.newPage();
  await page.goto(`${base}/kinben-seisekiritsu/index.html`);
  await page.waitForTimeout(500);
  await page.check('input[name="staff-type"][value="general"]');
  await page.check('input[name="regional-input-method"][value="rate"]');
  await page.selectOption("#regional-rate", "0.2");
  await page.fill("#dependent-base-addition", "31000");
  await page.fill("#term-amount", "955056");
  await page.fill("#merit-amount", "735463");
  await page.click("button[type=submit]");
  const rateText = await page.textContent("#result-rate");
  const categoryText = await page.textContent("#result-category");
  report(
    "kinben-seisekiritsu: 8級8号・管理職三種の支給額から良好102.25%を逆算できる",
    rateText === "102.25" && categoryText === "良好",
    `成績率=${rateText} 区分=${categoryText}`
  );
  await page.close();
}

// 成績率逆算: 入力内容をブラウザ内に保存し、再読み込み後に復元する
{
  const page = await browser.newPage();
  await page.goto(`${base}/kinben-seisekiritsu/index.html`);
  await page.evaluate(() => localStorage.removeItem("salary-calculator:kinben-seisekiritsu"));
  await page.reload();
  await page.selectOption("#salary-table-type", "administrative_1");
  await page.check('input[name="staff-type"][value="senior_manager"]');
  await page.check('input[name="regional-input-method"][value="location"]');
  await page.selectOption("#regional-prefecture", "東京都");
  await page.selectOption("#regional-municipality", { label: "特別区" });
  await page.fill("#dependent-base-addition", "31000");
  await page.fill("#term-amount", "955056");
  await page.fill("#merit-amount", "735463");
  await page.reload();
  await page.waitForTimeout(300);
  const staffTypeRestored = await page.isChecked('input[name="staff-type"][value="senior_manager"]');
  const prefectureRestored = await page.inputValue("#regional-prefecture");
  const municipalityLabel = await page.locator("#regional-municipality option:checked").textContent();
  const dependentRestored = await page.inputValue("#dependent-base-addition");
  const termRestored = await page.inputValue("#term-amount");
  const meritRestored = await page.inputValue("#merit-amount");
  report(
    "kinben-seisekiritsu: 入力内容が再読み込み後も復元される",
    staffTypeRestored && prefectureRestored === "東京都" && municipalityLabel === "特別区" &&
      dependentRestored.replaceAll(",", "") === "31000" &&
      termRestored.replaceAll(",", "") === "955056" && meritRestored.replaceAll(",", "") === "735463",
    `職員区分=${staffTypeRestored} 都道府県=${prefectureRestored} 市区町村=${municipalityLabel} 扶養=${dependentRestored} 期末=${termRestored} 勤勉=${meritRestored}`
  );
  await page.close();
}

// 成績率逆算: 地域手当の設定方法をラジオボタンで切り替える
{
  const page = await browser.newPage();
  await page.goto(`${base}/kinben-seisekiritsu/index.html`);
  await page.evaluate(() => localStorage.removeItem("salary-calculator:kinben-seisekiritsu"));
  await page.reload();
  const locationInitiallyVisible = await page.isVisible("#regional-location-inputs");
  const rateInitiallyHidden = await page.isHidden("#regional-rate-input");
  await page.check('input[name="regional-input-method"][value="rate"]');
  const locationAfterSwitchHidden = await page.isHidden("#regional-location-inputs");
  const rateAfterSwitchVisible = await page.isVisible("#regional-rate-input");
  report(
    "kinben-seisekiritsu: 地域手当の設定方法をラジオボタンで切り替えられる",
    locationInitiallyVisible && rateInitiallyHidden && locationAfterSwitchHidden && rateAfterSwitchVisible,
    `地域初期=${locationInitiallyVisible} 割合初期非表示=${rateInitiallyHidden} 地域切替後非表示=${locationAfterSwitchHidden} 割合切替後=${rateAfterSwitchVisible}`
  );
  await page.close();
}

// index.html: 勤務成績区分の初期値は6月期・12月期とも「良好」
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  const juneGood = await page.isChecked('input[name="merit-grade-june"][value="good"]');
  const decemberGood = await page.isChecked('input[name="merit-grade-december"][value="good"]');
  report(
    "index.html: 勤務成績区分は6月期・12月期とも「良好」が初期選択される",
    juneGood && decemberGood,
    `6月期=${juneGood} 12月期=${decemberGood}`
  );
  await page.close();
}

// index.html: 代表的な計算結果の妥当性
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.selectOption("#salary-table", "administrative_1");
  await setRegionalRate(page, "0");
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
  await goToDetailedTab(page);
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

// index.html: 行政職(一)の別の級・号俸（graded型）でも俸給月額が正の値になる
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.selectOption("#salary-table", "administrative_1");
  await page.selectOption("#grade", "3");
  await page.waitForTimeout(300);
  const baseSalaryText = await page.textContent("#r-base");
  const baseSalary = Number(baseSalaryText.replace(/[^\d]/g, ""));
  report(
    "index.html: 行政職(一) 3級の俸給月額が正の値",
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
  await goToDetailedTab(page);
  await page.selectOption("#salary-table", "administrative_1");
  await setRegionalRate(page, "0");
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

// index.html: 俸給の特別調整額を地域手当の算定基礎に含める
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.selectOption("#salary-table", "administrative_1");
  await page.selectOption("#grade", "4");
  await page.selectOption("#step", "1");
  await setRegionalRate(page, "0.2");
  await page.selectOption("#child-under15-count", "0");
  await page.selectOption("#child-16to22-count", "0");
  await page.selectOption("#parent-count", "0");
  await page.check("#special-adjustment-type-manager");
  await page.selectOption("#special-adjustment-category", "type4");
  await page.waitForTimeout(300);
  const specialAdjustmentText = await page.textContent("#r-special-adjustment");
  const regionalText = await page.textContent("#r-regional");
  report(
    "index.html: 4級1号・特別調整額55,500円・地域手当20%で地域手当は73,060円",
    specialAdjustmentText.includes("55,500") && regionalText.includes("73,060"),
    `特別調整額=${specialAdjustmentText} 地域手当=${regionalText}`
  );
  await page.close();
}

// index.html: 扶養手当がある場合も、賞与には俸給に対応する地域手当だけを算入する
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.selectOption("#salary-table", "administrative_1");
  await page.selectOption("#grade", "3");
  await page.selectOption("#step", "1");
  await setRegionalRate(page, "0.2");
  await page.selectOption("#child-under15-count", "0");
  await page.selectOption("#child-16to22-count", "0");
  await page.selectOption("#parent-count", "1");
  await page.check("#special-adjustment-type-general");
  await selectMeritGrade(page, "june", "good");
  await selectMeritGrade(page, "december", "good");
  await page.waitForTimeout(300);
  const bonusAnnualText = await page.textContent("#r-bonus-annual");
  report(
    "index.html: 行政職(一)3級1号・地域手当20%・父母等1人・良好の年間賞与は1,610,684円",
    bonusAnnualText.includes("1,610,684"),
    `実際の表示: ${bonusAnnualText}`
  );
  await page.close();
}

// index.html: 特定管理職員の賞与には俸給の特別調整額の区分に応じた管理職加算を算入する
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.selectOption("#salary-table", "administrative_1");
  await setReadonlyNumber(page, "#grade", 10);
  await setReadonlyNumber(page, "#step", 8);
  await setRegionalRate(page, "0.2");
  await page.selectOption("#child-under15-count", "1");
  await page.selectOption("#child-16to22-count", "1");
  await page.check("#special-adjustment-type-manager");
  await page.selectOption("#special-adjustment-category", "type1");
  await page.check("#honsho-eligible-yes");
  await selectMeritGrade(page, "june", "good");
  await selectMeritGrade(page, "december", "good");
  await page.waitForTimeout(300);
  const monthlyText = await page.textContent("#r-monthly-total");
  const bonusAnnualText = await page.textContent("#r-bonus-annual");
  report(
    "index.html: 10級8号・特定管理職員一種・本省・地域20%・子2人・良好の年間賞与は4,682,134円",
    monthlyText.includes("971,360") && bonusAnnualText.includes("4,682,134"),
    `月額=${monthlyText} 年間賞与=${bonusAnnualText}`
  );
  await page.close();
}

// index.html: 俸給の特別調整額三種は賞与上の特定管理職員・管理職加算の対象外
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.selectOption("#salary-table", "administrative_1");
  await setReadonlyNumber(page, "#grade", 8);
  await setReadonlyNumber(page, "#step", 8);
  await setRegionalRate(page, "0.2");
  await page.selectOption("#child-under15-count", "1");
  await page.selectOption("#child-16to22-count", "1");
  await page.check("#special-adjustment-type-manager");
  await page.selectOption("#special-adjustment-category", "type3");
  await page.check("#honsho-eligible-yes");
  await selectMeritGrade(page, "june", "good");
  await selectMeritGrade(page, "december", "good");
  await page.waitForTimeout(300);
  const bonusAnnualText = await page.textContent("#r-bonus-annual");
  report(
    "index.html: 8級8号・管理職三種・本省・地域20%・子2人・良好の年間賞与は3,381,038円",
    bonusAnnualText.includes("3,381,038"),
    `実際の表示: ${bonusAnnualText}`
  );
  await page.close();
}

// index.html: 超過勤務時間は−10/−1/+1/+10ボタンで増減でき、0未満にはならない
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  const plusTen = page.getByRole("button", { name: "平日通常の時間外勤務を10時間増やす", exact: true });
  const plusOne = page.getByRole("button", { name: "平日通常の時間外勤務を1時間増やす", exact: true });
  const minusOne = page.getByRole("button", { name: "平日通常の時間外勤務を1時間減らす", exact: true });
  const minusTen = page.getByRole("button", { name: "平日通常の時間外勤務を10時間減らす", exact: true });
  const buttonCount = (await plusTen.count()) + (await plusOne.count()) + (await minusOne.count()) + (await minusTen.count());
  await plusTen.click();
  await plusOne.click();
  const afterIncrease = await page.inputValue("#ot-weekday-normal");
  await minusTen.click();
  await minusTen.click();
  const afterDecrease = await page.inputValue("#ot-weekday-normal");
  report(
    "index.html: 超過勤務時間は−10/−1/+1/+10ボタンで増減でき、0未満にはならない",
    buttonCount === 4 && afterIncrease === "11" && afterDecrease === "0",
    `ボタン数=${buttonCount} 加算後=${afterIncrease} 減算後=${afterDecrease}`
  );
  await page.close();
}

// index.html: 号俸の昇給ボタン（+4/+6/+8, -4/-6/-8）が正しく増減する
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
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

// index.html: 昇格ボタンは公式の対応表で1級上の号俸を設定し、戻るで直前の級・号俸を復元する
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.selectOption("#grade", "2");
  await page.selectOption("#step", "50");
  await page.click("#promote-grade");
  await page.waitForTimeout(150);
  const promotedGrade = await page.inputValue("#grade");
  const promotedStep = await page.inputValue("#step");
  const undoVisible = await page.isVisible("#undo-promotion");
  await page.click("#undo-promotion");
  await page.waitForTimeout(150);
  const restoredGrade = await page.inputValue("#grade");
  const restoredStep = await page.inputValue("#step");
  const undoHidden = await page.isHidden("#undo-promotion");
  report(
    "index.html: 昇格で公式対応表どおり2級50号→3級30号となり、戻るで2級50号へ復元できる",
    promotedGrade === "3" && promotedStep === "30" && undoVisible && restoredGrade === "2" && restoredStep === "50" && undoHidden,
    `昇格後=${promotedGrade}級${promotedStep}号 戻し後=${restoredGrade}級${restoredStep}号`
  );
  await page.close();
}

// index.html: 住居手当は既定「支給なし」で0円、「支給あり」にすると家賃20,000円で4,000円が反映される
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  const defaultChecked = await page.isChecked("#housing-eligible-no");
  const defaultHousingText = await page.textContent("#r-housing");
  const amountFieldHiddenByDefault = await page.isHidden("#housing-amount-field");
  await page.check("#housing-eligible-yes");
  await page.fill("#housing-rent", "20000");
  await page.waitForTimeout(200);
  const housingText = await page.textContent("#r-housing");
  const hintText = await page.textContent("#housing-amount-hint");
  report(
    "index.html: 住居手当は既定で支給なし(0円、金額欄は非表示)、支給ありで家賃20,000円なら4,000円が反映される",
    defaultChecked &&
      defaultHousingText.includes("0") &&
      amountFieldHiddenByDefault &&
      housingText.includes("4,000") &&
      hintText.includes("4,000"),
    `既定チェック=${defaultChecked}/${defaultHousingText}/非表示=${amountFieldHiddenByDefault} 支給あり後=${housingText} ヒント=${hintText}`
  );
  await page.close();
}

// index.html: 家賃が高額でも住居手当は28,000円が上限になる
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.check("#housing-eligible-yes");
  await page.fill("#housing-rent", "100000");
  await page.waitForTimeout(200);
  const housingText = await page.textContent("#r-housing");
  report(
    "index.html: 家賃100,000円でも住居手当は上限の28,000円になる",
    housingText.includes("28,000"),
    `表示=${housingText}`
  );
  await page.close();
}

// index.html: 家賃は千円・一万円の増減ボタンで操作でき、0円未満にはならない
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.check("#housing-eligible-yes");
  await page.click('.counter-btn[data-target="housing-rent"][data-delta="1000"]');
  await page.click('.counter-btn[data-target="housing-rent"][data-delta="10000"]');
  const increasedValue = await page.inputValue("#housing-rent");
  await page.click('.counter-btn[data-target="housing-rent"][data-delta="-10000"]');
  await page.click('.counter-btn[data-target="housing-rent"][data-delta="-1000"]');
  await page.click('.counter-btn[data-target="housing-rent"][data-delta="-1000"]');
  const clampedValue = await page.inputValue("#housing-rent");
  report(
    "index.html: 家賃は−1万/−1千/+1千/+1万ボタンで増減でき、0円未満にはならない",
    increasedValue === "11000" && clampedValue === "0",
    `増額後=${increasedValue} 下限後=${clampedValue}`
  );
  await page.close();
}

// index.html: 住居手当を「支給あり」にして家賃を入れても、「支給なし」に戻すと0円になる（持ち家扱い）
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.check("#housing-eligible-yes");
  await page.fill("#housing-rent", "20000");
  await page.waitForTimeout(200);
  await page.check("#housing-eligible-no");
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
  await goToDetailedTab(page);
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
  await goToDetailedTab(page);
  await page.selectOption("#salary-table", "administrative_1");
  await setRegionalRate(page, "0");
  await selectMeritGrade(page, "june", "good");
  await page.waitForTimeout(200);
  const kinbenGood = await page.textContent("#r-kinben-june");
  const teishuGood = await page.textContent("#r-teishu-june");
  await selectMeritGrade(page, "june", "excellent_plus");
  await page.waitForTimeout(200);
  const kinbenExcellentPlus = await page.textContent("#r-kinben-june");
  const teishuExcellentPlus = await page.textContent("#r-teishu-june");
  report(
    "index.html: 成績区分を「良好」→「特に優秀」に変えると勤勉手当が増え、期末手当は変わらない",
    !kinbenExcellentPlus.includes("NaN") && kinbenExcellentPlus !== kinbenGood && teishuExcellentPlus === teishuGood,
    `勤勉(良好)=${kinbenGood} 勤勉(特に優秀)=${kinbenExcellentPlus} 期末(良好)=${teishuGood} 期末(特に優秀)=${teishuExcellentPlus}`
  );
  await page.close();
}

// index.html: 指定職職員では「特に優秀」の選択肢が存在しない
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.selectOption("#salary-table", "designated");
  await page.waitForTimeout(200);
  const gradeOptions = await page.$$eval('input[name="merit-grade-june"]', (inputs) => inputs.map((input) => input.value));
  report(
    "index.html: 指定職職員には「特に優秀」の選択肢がない",
    !gradeOptions.includes("excellent_plus"),
    `選択肢: ${JSON.stringify(gradeOptions)}`
  );
  await page.close();
}

// index.html: 成績率は成績区分の範囲内に制限され、「良好でない」では0を入力できる
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.selectOption("#salary-table", "administrative_1");
  await setRegionalRate(page, "0");
  await page.check("#special-adjustment-type-general");
  await selectMeritGrade(page, "june", "excellent_plus");
  const excellentPlusMin = await page.getAttribute("#merit-rate-june", "min");
  const excellentPlusMax = await page.getAttribute("#merit-rate-june", "max");
  await page.fill("#merit-rate-june", "999");
  await page.locator("#merit-rate-june").blur();
  const normalizedExcellentPlus = await page.inputValue("#merit-rate-june");
  await selectMeritGrade(page, "june", "good");
  const goodMin = await page.getAttribute("#merit-rate-june", "min");
  const goodMax = await page.getAttribute("#merit-rate-june", "max");
  const decreaseTenButton = page.getByRole("button", { name: "6月期の成績率を10ポイント下げる", exact: true });
  const decreaseOneButton = page.getByRole("button", { name: "6月期の成績率を1ポイント下げる", exact: true });
  const increaseOneButton = page.getByRole("button", { name: "6月期の成績率を1ポイント上げる", exact: true });
  const increaseTenButton = page.getByRole("button", { name: "6月期の成績率を10ポイント上げる", exact: true });
  const rateButtonCount =
    (await decreaseTenButton.count()) +
    (await decreaseOneButton.count()) +
    (await increaseOneButton.count()) +
    (await increaseTenButton.count());
  await page.fill("#merit-rate-june", "999");
  await page.locator("#merit-rate-june").blur();
  const normalizedGood = await page.inputValue("#merit-rate-june");
  await selectMeritGrade(page, "june", "not_good");
  await page.fill("#merit-rate-june", "0");
  await page.locator("#merit-rate-june").blur();
  const zeroRate = await page.inputValue("#merit-rate-june");
  const kinbenZero = await page.textContent("#r-kinben-june");
  await increaseOneButton.click();
  const incrementedRate = await page.inputValue("#merit-rate-june");
  report(
    "index.html: 成績率は区分の範囲内に制限され、「良好でない」では0を入力できる",
    excellentPlusMin === "125.25" &&
      excellentPlusMax === "318.75" &&
      normalizedExcellentPlus === "318.75" &&
      goodMin === "102.25" &&
      goodMax === "102.25" &&
      rateButtonCount === 4 &&
      normalizedGood === "102.25" &&
      zeroRate === "0" &&
      incrementedRate === "1" &&
      kinbenZero.includes("0"),
    `特に優秀の範囲=${excellentPlusMin}〜${excellentPlusMax} 正規化=${normalizedExcellentPlus} 良好の範囲=${goodMin}〜${goodMax} 正規化=${normalizedGood} 良好でない=${zeroRate}/${kinbenZero} 加算後=${incrementedRate}`
  );
  await page.close();
}

// index.html: 勤勉手当は6月期・12月期で別々に成績区分を設定できる
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.selectOption("#salary-table", "administrative_1");
  await setRegionalRate(page, "0");
  await selectMeritGrade(page, "june", "excellent_plus");
  await selectMeritGrade(page, "december", "not_good");
  await page.waitForTimeout(200);
  const kinbenJune = await page.textContent("#r-kinben-june");
  const kinbenDecember = await page.textContent("#r-kinben-december");
  const teishuJune = await page.textContent("#r-teishu-june");
  const teishuDecember = await page.textContent("#r-teishu-december");
  report(
    "index.html: 6月期「特に優秀」・12月期「良好でない」で勤勉手当が期ごとに異なり、期末手当は変わらない",
    !kinbenJune.includes("NaN") && kinbenJune !== kinbenDecember && teishuJune === teishuDecember,
    `勤勉(6月)=${kinbenJune} 勤勉(12月)=${kinbenDecember} 期末(6月)=${teishuJune} 期末(12月)=${teishuDecember}`
  );
  await page.close();
}

// index.html: 扶養親族数のボタンで増減し、0未満にはならない
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
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

// index.html: 俸給表バージョンのプルダウンで「現行」「人事院勧告反映後（令和9年度）」がともに選択可能
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  const options = await page.$$eval('#salary-vintage-group input[name="salary-vintage"]', (opts) =>
    opts.map((o) => ({ value: o.value, disabled: o.disabled }))
  );
  const current = options.find((o) => o.value === "current");
  const reiwa9Nendo = options.find((o) => o.value === "reiwa9_nendo");
  report(
    "index.html: 俸給表バージョンは現行・人事院勧告反映後（令和9年度）のどちらも選択可能",
    current && !current.disabled && reiwa9Nendo && !reiwa9Nendo.disabled,
    JSON.stringify(options)
  );
  await page.close();
}

// index.html: 「人事院勧告反映後（令和9年度）」に切り替えると俸給月額が反映される
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.selectOption("#grade", "1");
  await page.selectOption("#step", "1");
  await page.waitForTimeout(150);
  const salaryBefore = await page.textContent("#r-base");
  await page.check("#salary-vintage-reiwa9_nendo");
  await page.waitForTimeout(300);
  const salaryAfter = await page.textContent("#r-base");
  report(
    "index.html: 人事院勧告反映後（令和9年度）に切り替えると俸給月額が変わる",
    salaryBefore !== salaryAfter,
    `切替前=${salaryBefore} 切替後=${salaryAfter}`
  );
  await page.close();
}

// index.html: 「人事院勧告反映後（令和9年度）」では現行との差額が併記され、「現行」に戻すと消える
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.selectOption("#salary-table", "administrative_1");
  await page.selectOption("#grade", "1");
  await page.selectOption("#step", "1");
  await page.waitForTimeout(150);
  const diffHiddenOnCurrent = await page.isHidden("#r-base-diff");

  await page.check("#salary-vintage-reiwa9_nendo");
  await page.waitForTimeout(300);
  const diffVisibleOnReiwa9Nendo = await page.isVisible("#r-base-diff");
  const baseDiffText = await page.textContent("#r-base-diff");
  const annualDiffText = await page.textContent("#r-annual-diff");
  const heroDiffText = await page.textContent("#r-annual-hero-diff");
  const noteVisible = await page.isVisible("#result-table-diff-header");

  await page.check("#salary-vintage-current");
  await page.waitForTimeout(300);
  const diffHiddenAfterRevert = await page.isHidden("#r-base-diff");

  report(
    "index.html: 人事院勧告反映後（令和9年度）では俸給月額・年収に現行との差額（+9,500円等）が併記され、現行に戻すと消える",
    diffHiddenOnCurrent &&
      diffVisibleOnReiwa9Nendo &&
      baseDiffText === "+￥9,500" &&
      annualDiffText.startsWith("+") &&
      heroDiffText.startsWith("+") &&
      noteVisible &&
      diffHiddenAfterRevert,
    `現行時hidden=${diffHiddenOnCurrent} 令和9年度visible=${diffVisibleOnReiwa9Nendo} 俸給差額=${baseDiffText} 年収差額=${annualDiffText} hero差額=${heroDiffText} note表示=${noteVisible} 復帰後hidden=${diffHiddenAfterRevert}`
  );
  await page.close();
}

// index.html（かんたんモード）: 「人事院勧告反映後（令和9年度）」では年収目安に現行との差額が併記される
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
  const diffHiddenOnCurrent = await page.isHidden("#simple-r-annual-hero-diff");

  await page.check("#simple-salary-vintage-reiwa9_nendo");
  await page.waitForTimeout(300);
  const diffVisibleOnReiwa9Nendo = await page.isVisible("#simple-r-annual-hero-diff");
  const heroDiffText = await page.textContent("#simple-r-annual-hero-diff");

  report(
    "index.html（かんたんモード）: 人事院勧告反映後（令和9年度）では年収目安に現行との差額が併記される",
    diffHiddenOnCurrent && diffVisibleOnReiwa9Nendo && heroDiffText.startsWith("+"),
    `現行時hidden=${diffHiddenOnCurrent} 令和9年度visible=${diffVisibleOnReiwa9Nendo} hero差額=${heroDiffText}`
  );
  await page.close();
}

// index.html: 設定方法によって入力欄が分岐し、地域選択時は支給割合へ反映される
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  const locationInitiallyVisible = await page.isVisible("#regional-location-inputs");
  const rateInitiallyHidden = await page.isHidden("#regional-rate-input");
  await page.selectOption("#regional-prefecture", "東京都");
  await page.selectOption("#regional-municipality", { label: "武蔵野市" });
  await page.waitForTimeout(150);
  const rateAfterRegion = await page.inputValue("#regional-rate");
  const statusAfterRegion = await page.textContent("#regional-rate-status");
  await page.check("#regional-input-method-rate");
  await page.waitForTimeout(100);
  const locationAfterSwitchHidden = await page.isHidden("#regional-location-inputs");
  const rateAfterSwitchVisible = await page.isVisible("#regional-rate-input");
  await setRegionalRate(page, "0");
  await page.waitForTimeout(150);
  const municipalityAfterManualChange = await page.inputValue("#regional-municipality");
  report(
    "index.html: 設定方法で入力欄が分岐し、地域選択で令和8年度の率に反映される",
    locationInitiallyVisible && rateInitiallyHidden && rateAfterRegion === "0.16" &&
      statusAfterRegion.includes("16%") && locationAfterSwitchHidden && rateAfterSwitchVisible &&
      municipalityAfterManualChange === "",
    `地域初期表示=${locationInitiallyVisible} 割合初期非表示=${rateInitiallyHidden} rate=${rateAfterRegion} status=${statusAfterRegion} 地域切替後非表示=${locationAfterSwitchHidden} 割合切替後表示=${rateAfterSwitchVisible}`
  );
  await page.close();
}

// index.html: 入力内容がlocalStorageに保存され、リロード後も復元される
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.check("#housing-eligible-yes");
  await page.fill("#housing-rent", "23000");
  await setRegionalRate(page, "0.12");
  await page.waitForTimeout(200);
  await page.reload();
  await page.waitForTimeout(500);
  const housingEligibleChecked = await page.isChecked("#housing-eligible-yes");
  const housingValue = await page.inputValue("#housing-rent");
  const regionalValue = await page.inputValue("#regional-rate");
  report(
    "index.html: 入力内容がリロード後も復元される",
    housingEligibleChecked && housingValue === "23000" && regionalValue === "0.12",
    `housing-eligible-yes=${housingEligibleChecked} housing=${housingValue} regional=${regionalValue}`
  );
  await page.close();
}

// index.html: 「保存した入力内容を削除」ボタンで初期状態に戻る
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await goToDetailedTab(page);
  await page.check("#housing-eligible-yes");
  await page.fill("#housing-rent", "23000");
  await page.waitForTimeout(200);
  await page.click("#reset-saved-input");
  await page.waitForTimeout(500);
  const housingEligibleNoChecked = await page.isChecked("#housing-eligible-no");
  report(
    "index.html: 保存データ削除ボタンで住居手当が初期値（支給なし）に戻る",
    housingEligibleNoChecked,
    `housing-eligible-no=${housingEligibleNoChecked}`
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
