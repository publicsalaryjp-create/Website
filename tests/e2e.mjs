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
  await page.fill("#step", "1");
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
  await page.fill("#step", "1");
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
  await page.fill("#step", "10");
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

// index.html: 住居形態を「持ち家」にすると家賃入力欄が隠れる
{
  const page = await browser.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForTimeout(500);
  await page.selectOption("#housing-type", "owned");
  await page.waitForTimeout(150);
  const rentFieldHidden = await page.getAttribute("#rent-field", "hidden");
  report("index.html: 持ち家を選ぶと家賃入力欄が非表示になる", rentFieldHidden === "", `hidden属性: ${rentFieldHidden}`);
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

await browser.close();
await new Promise((resolve) => server.close(resolve));

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nすべてのE2Eチェックに合格しました");
