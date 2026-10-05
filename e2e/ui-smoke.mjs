#!/usr/bin/env node
/**
 * 浏览器端冒烟测试：用系统 Chrome 打开真实页面，走一遍「注册 → 建家庭 → 记物品 → 看详情 → 时间轴」。
 * 只依赖 playwright-core + 本机 Chrome，不需要下载浏览器内核。
 *
 * 用法：
 *   WEB=http://localhost:5173 node e2e/ui-smoke.mjs
 *   HEADLESS=false node e2e/ui-smoke.mjs   # 想看过程时
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const WEB = process.env.WEB ?? 'http://localhost:5173';
const HEADLESS = process.env.HEADLESS !== 'false';
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/heirloom-shots';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let pass = 0;
let fail = 0;
const ok = (m) => {
  console.log(`  \x1b[32m✓\x1b[0m ${m}`);
  pass += 1;
};
const bad = (m) => {
  console.log(`  \x1b[31m✗\x1b[0m ${m}`);
  fail += 1;
};
const step = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

mkdirSync(SHOT_DIR, { recursive: true });

/** 点分段控件里的某个选项；失败时把页面上的可选项打到日志里，便于定位 */
async function clickRadio(page, name) {
  const target = page.getByRole('radio', { name, exact: true });
  try {
    await target.waitFor({ state: 'visible', timeout: 10000 });
    await target.click();
  } catch (err) {
    const options = await page.getByRole('radio').allInnerTexts().catch(() => []);
    console.log(`      · 当前页面可选项：${JSON.stringify(options)}`);
    console.log(`      · 当前地址：${page.url()}`);
    throw err;
  }
}

const browser = await chromium.launch({ executablePath: CHROME, headless: HEADLESS });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(String(err)));

/** 记录所有失败请求的 URL，便于区分「预期内的探测失败」和真正的接口报错 */
const failedResponses = [];
page.on('response', (res) => {
  if (res.status() >= 400) failedResponses.push({ status: res.status(), url: res.url() });
});

const runId = `${Date.now()}`;
const email = `ui-${runId}@example.com`;

try {
  step('1/6 打开登录页');
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  if (await page.locator('h1', { hasText: '家中物品来历册' }).isVisible()) ok('登录页渲染正常');
  else bad('登录页没有渲染出标题');
  await page.screenshot({ path: `${SHOT_DIR}/01-login.png` });

  step('2/6 注册新账号');
  await page.getByRole('link', { name: '创建管理员账号' }).click();
  await page.waitForURL('**/register');
  await page.getByLabel('你的称呼').fill('测试大姐');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill('family2026');
  await page.getByRole('button', { name: '注册' }).click();

  // 新库会直接注册成功并跳走；已初始化的库会留在注册页并给出提示
  const outcome = await Promise.race([
    page.waitForURL((url) => !url.pathname.includes('/register'), { timeout: 15000 }).then(() => 'navigated'),
    page
      .locator('.field__error')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(() => 'error'),
  ]).catch(() => 'timeout');

  const registerError =
    outcome === 'error' ? await page.locator('.field__error').first().innerText().catch(() => '') : '';

  if (outcome === 'navigated') {
    ok('注册成功并进入下一步');
  } else if (registerError.includes('未开放公开注册')) {
    ok('系统已初始化，注册被正确拒绝并给出提示');
    // 已初始化的库上，改用已存在的账号登录，继续验证后续页面
    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    const seededEmail = process.env.OWNER_EMAIL;
    const seededPassword = process.env.OWNER_PASSWORD ?? 'family2026';
    if (!seededEmail) throw new Error('库已初始化：请用 OWNER_EMAIL/OWNER_PASSWORD 指定一个既有账号再跑');
    await page.getByLabel('邮箱').fill(seededEmail);
    await page.getByLabel('密码').fill(seededPassword);
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
    ok('既有账号登录成功');
  } else {
    bad(`注册没有成功（outcome=${outcome}, error=${registerError}）`);
  }
  await page.screenshot({ path: `${SHOT_DIR}/02-families.png` });

  step('3/6 建立家庭空间');
  if (await page.getByRole('heading', { name: '我的家庭' }).isVisible().catch(() => false)) {
    const createButton = page.getByRole('button', { name: /建立.*家庭空间/ }).first();
    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      await page.getByLabel('家庭名称').fill(`测试之家 ${runId.slice(-4)}`);
      await page.getByRole('button', { name: '创建' }).click();
      await page.waitForURL(/\/f\//, { timeout: 15000 });
      ok('已创建并进入家庭首页');
    } else {
      await page.locator('.item-card').first().click();
      await page.waitForURL(/\/f\//, { timeout: 15000 });
      ok('已进入既有家庭首页');
    }
  }
  await page.screenshot({ path: `${SHOT_DIR}/03-home.png` });

  step('4/6 记录一件物品');
  await page.getByRole('button', { name: '记一件物品' }).first().click();
  await page.waitForURL('**/items/new');
  await page.getByLabel('名称').fill('外公的樟木箱');
  await clickRadio(page, '老家具');
  await clickRadio(page, '精确到年');
  await page.getByLabel('年份').fill('1978');
  await page.getByLabel('用自己的话说').fill('我上小学那年搬进的新家');
  await page.getByLabel('拿到这件东西的地方').fill('老家堂屋');
  await page.getByLabel('物品的故事').fill('外公在县城木器社亲手打的，箱底还留着他的名字。');
  await page.screenshot({ path: `${SHOT_DIR}/04-form.png`, fullPage: true });
  await page.getByRole('button', { name: '保存' }).first().click();
  await page.waitForURL(/\/items\/[^/]+$/, { timeout: 15000 });
  ok('条目已保存并跳转到详情页');

  // 新建的条目是草稿；发布后才会进入时间轴和家人的列表
  await page.getByRole('button', { name: '发布' }).click();
  await page.waitForTimeout(800);
  ok('草稿已发布');

  step('5/6 详情页与时间展示');
  const title = await page.locator('.detail-title').innerText();
  if (title.includes('樟木箱')) ok('详情页显示物品名称');
  else bad(`详情页名称异常：${title}`);
  const bodyText = await page.locator('body').innerText();
  if (bodyText.includes('1978 年')) ok('模糊时间按精度展示为「1978 年」');
  else bad('详情页没有按精度展示时间');
  if (bodyText.includes('时间存疑')) ok('标注了「时间存疑」');
  else bad('缺少时间存疑标注');
  if (bodyText.includes('外公在县城木器社')) ok('故事正文正常渲染');
  else bad('故事正文没有渲染');
  await page.screenshot({ path: `${SHOT_DIR}/05-detail.png`, fullPage: true });

  step('6/6 时间轴与移动端布局');
  await page.getByRole('link', { name: '时间轴' }).click();
  await page.waitForURL('**/timeline');
  await page
    .locator('.timeline__group, .empty')
    .first()
    .waitFor({ state: 'visible', timeout: 15000 });
  const timelineText = await page.locator('body').innerText();
  if (timelineText.includes('1978')) ok('时间轴按获得时间分组并展示 1978');
  else bad('时间轴没有出现 1978 分组');
  await page.screenshot({ path: `${SHOT_DIR}/06-timeline.png`, fullPage: true });

  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow <= 1) ok('360px 宽度下无横向溢出');
  else bad(`移动端出现横向溢出 ${overflow}px`);
  await page.screenshot({ path: `${SHOT_DIR}/07-mobile.png`, fullPage: true });

  // 允许的预期失败：favicon 请求、未登录时探测会话的 401、以及分享页探测
  const expected = (r) =>
    r.url.includes('favicon') ||
    (r.status === 401 && /\/auth\/(me|refresh)$/.test(r.url)) ||
    // 库已初始化时，注册被拒是预期路径，测试会回退到既有账号登录
    (r.status === 409 && /\/auth\/register$/.test(r.url));
  const realFailures = failedResponses.filter((r) => !expected(r));
  if (realFailures.length === 0) ok('没有非预期的接口报错');
  else
    bad(
      `非预期接口报错 ${realFailures.length} 条：` +
        realFailures
          .slice(0, 5)
          .map((r) => `${r.status} ${r.url.replace(WEB, '')}`)
          .join(' | '),
    );
} catch (err) {
  bad(`执行中断：${err instanceof Error ? err.message : String(err)}`);
  await page.screenshot({ path: `${SHOT_DIR}/error.png`, fullPage: true }).catch(() => undefined);
} finally {
  await browser.close();
}

console.log(`\n\x1b[1m结果：${pass} 项通过，${fail} 项失败\x1b[0m`);
console.log(`截图目录：${SHOT_DIR}`);
process.exit(fail > 0 ? 1 : 0);
