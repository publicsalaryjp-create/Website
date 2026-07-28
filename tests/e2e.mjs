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
  await page.selectOption("#grade", "1");
  await page.selectOption("#step", "1");
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

// index.html: 扶養手当が15歳以下/16〜22歳/父母等の区分ごとに正しく合算される
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#salary-table", "administrative_1");
  await page.selectOption("#grade", "1");
  await page.selectOption("#step", "1");
  await page.selectOption("#regional-rate", "0");
  await page.fill("#child-under15-count", "1");
  await page.fill("#child-16to22-count", "1");
  await page.fill("#parent-count", "1");
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
  await page.selectOption("#step", "10");
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

// index.html: 住居手当は既定値0円で、入力した金額がそのまま反映される
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  const defaultValue = await page.inputValue("#housing-allowance");
  await page.fill("#housing-allowance", "15000");
  await page.waitForTimeout(200);
  const housingText = await page.textContent("#r-housing");
  report(
    "index.html: 住居手当の既定値は0円で、入力額(15,000円)がそのまま反映される",
    defaultValue === "0" && housingText.includes("15,000"),
    `既定値=${defaultValue} 表示=${housingText}`
  );
  await page.close();
}

// index.html: 勤務成績区分を変えると勤勉手当（6月期）が変わる（一般職員: 良好→特に優秀）
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#salary-table", "administrative_1");
  await page.selectOption("#grade", "1");
  await page.selectOption("#step", "1");
  await page.selectOption("#regional-rate", "0");
  await page.selectOption("#merit-staff-type", "general");
  await page.selectOption("#merit-grade", "good");
  await page.waitForTimeout(200);
  const kinbenGood = await page.textContent("#r-kinben-june");
  const teishuGood = await page.textContent("#r-teishu-june");
  await page.selectOption("#merit-grade", "excellent_plus");
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
  await page.selectOption("#merit-staff-type", "designated");
  await page.waitForTimeout(200);
  const gradeOptions = await page.$$eval("#merit-grade option", (opts) => opts.map((o) => o.value));
  report(
    "index.html: 指定職職員には「特に優秀」の選択肢がない",
    !gradeOptions.includes("excellent_plus"),
    `選択肢: ${JSON.stringify(gradeOptions)}`
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

// index.html: 入力内容がlocalStorageに保存され、リロード後も復元される
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.fill("#housing-allowance", "23000");
  await page.selectOption("#regional-rate", "0.12");
  await page.waitForTimeout(200);
  await page.reload();
  await page.waitForTimeout(500);
  const housingValue = await page.inputValue("#housing-allowance");
  const regionalValue = await page.inputValue("#regional-rate");
  report(
    "index.html: 入力内容がリロード後も復元される",
    housingValue === "23000" && regionalValue === "0.12",
    `housing=${housingValue} regional=${regionalValue}`
  );
  await page.close();
}

// index.html: 「保存した入力内容を削除」ボタンで初期状態に戻る
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.fill("#housing-allowance", "23000");
  await page.waitForTimeout(200);
  await page.click("#reset-saved-input");
  await page.waitForTimeout(500);
  const housingValue = await page.inputValue("#housing-allowance");
  report(
    "index.html: 保存データ削除ボタンで住居手当が初期値0に戻る",
    housingValue === "0",
    `housing=${housingValue}`
  );
  await page.close();
}

// new-hire.html: 入力内容がリロード後も復元される
{
  const page = await browser.newPage();
  await page.goto(`${base}/new-hire.html`);
  await page.waitForTimeout(500);
  await page.fill("#housing-allowance", "8000");
  await page.waitForTimeout(200);
  await page.reload();
  await page.waitForTimeout(500);
  const housingValue = await page.inputValue("#housing-allowance");
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
