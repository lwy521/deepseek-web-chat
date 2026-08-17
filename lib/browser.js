// ========================
// 浏览器管理 + 登录
// ========================
const { chromium } = require("playwright-core");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { CONFIG, state } = require("./state");

const STORAGE_STATE = path.join(os.tmpdir(), "deepseek-browser-state.json");

const SEL = {
  textarea: 'textarea[placeholder*="发送消息"]',
  response: "div.ds-markdown.ds-assistant-message-main-content",
  reasoning: "div.ds-markdown.ds-assistant-message-main-content details",
  modeFast: 'div[role="radio"]:has-text("快速模式")',
  modeExpert: 'div[role="radio"]:has-text("专家模式")',
  modeVision: 'div[role="radio"]:has-text("识图模式")',
  toggleDeepThink: 'div.ds-toggle-button:has-text("深度思考")',
  toggleWebSearch: 'div.ds-toggle-button:has-text("智能搜索")',
};

// 初始化浏览器（单例，带并发锁）
async function ensureBrowser() {
  if (state.browserStarted && state.page && !state.page.isClosed()) return;
  if (state.initPromise) return state.initPromise;

  state.initPromise = (async () => {
    // 使用无 profile 模式（launchPersistentContext 在此系统上会导致 Edge 崩溃）
    // 登录态通过 storageState 文件持久化
    const browser = await chromium.launch({
      headless: true, channel: "msedge",
      args: ["--disable-blink-features=AutomationControlled"],
      viewport: { width: 1280, height: 800 },
    });

    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    // 加载保存的登录态
    if (fs.existsSync(STORAGE_STATE)) {
      try {
        await context.addCookies(JSON.parse(fs.readFileSync(STORAGE_STATE, "utf8")).cookies || []);
      } catch {}
    }

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    });

    let page = (await context.pages())[0];
    if (!page) page = await context.newPage();

    const loggedIn = await doLogin(page);
    if (!loggedIn) {
      console.log("[FAIL] 无法登录");
      await context.close();
      await browser.close();
      process.exit(1);
    }

    // 保存登录态
    try {
      const storageState = await context.storageState();
      fs.writeFileSync(STORAGE_STATE, JSON.stringify(storageState));
    } catch {}

    state.page = page;
    state.context = context;
    state.browser = browser;
    state.browserStarted = true;
    state.currentMode = "fast";
  })().finally(() => {
    state.initPromise = null;
  });

  await state.initPromise;
}

// 关闭浏览器
async function closeBrowser() {
  if (state.browser) {
    try { await state.browser.close(); } catch (e) { console.log("[WARN] 浏览器关闭异常:", e.message); }
    state.browser = null;
  }
  if (state.context) {
    try { await state.context.close(); } catch (e) { console.log("[WARN] 浏览器关闭异常:", e.message); }
    state.context = null;
  }
  state.page = null;
  state.browserStarted = false;
}

// 登录流程
async function doLogin(page) {
  await page.goto("https://chat.deepseek.com", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // 多条件判断是否已登录：URL 不含 sign_in + 出现聊天输入框
  const isLoggedIn = await page.evaluate(() => {
    const url = location.href;
    if (/\/sign_in/.test(url)) return false;
    // 检查是否有聊天输入框（登录后的标志）
    const textarea = document.querySelector('textarea[placeholder*="发送消息"]');
    return textarea !== null;
  });

  if (isLoggedIn) return true;

  if (CONFIG.autoLogin.enabled && CONFIG.autoLogin.phone && CONFIG.autoLogin.password) {
    console.log("[*] 尝试自动登录...");
    if (await tryAutoLogin(page)) {
      console.log("[OK] 自动登录成功");
      return true;
    }
    console.log("[!] 自动登录失败");
  }

  // 自动登录失败且无可视窗口配置时，直接返回失败
  if (process.env.DEEPSEEK_MANUAL_LOGIN !== "true") {
    console.log("[!] 自动登录失败，请检查 config.json 或删除旧会话重试");
    return false;
  }

  // 弹出可见浏览器窗口手动登录（需设置 DEEPSEEK_MANUAL_LOGIN=true）
  console.log("[*] 请在浏览器中完成登录...");
  try {
    const manualBrowser = await chromium.launch({
      headless: false, channel: "msedge",
      args: ["--disable-blink-features=AutomationControlled"],
      viewport: { width: 1280, height: 800 },
    });
    const manualCtx = await manualBrowser.newContext({ viewport: { width: 1280, height: 800 } });
    await manualCtx.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    });
    let manualPage = (await manualCtx.pages())[0];
    if (!manualPage) manualPage = await manualCtx.newPage();
    await manualPage.goto("https://chat.deepseek.com", { waitUntil: "domcontentloaded", timeout: 30000 });

    try {
      await manualPage.waitForURL(/deepseek\.com\/chat\//, { timeout: CONFIG.responseTimeout });
      console.log("[OK] 手动登录成功");
    } catch {
      console.log("[!] 手动登录超时");
      await manualCtx.close();
      await manualBrowser.close();
      return false;
    }
    await manualCtx.close();
    await manualBrowser.close();
    return true;
  } catch (e) {
    console.log("[!] 手动登录失败:", e.message);
    return false;
  }
}

// 自动登录（手机号 + 密码）
async function tryAutoLogin(page) {
  try {
    console.log("[auto] 等待页面加载...");
    await page.waitForTimeout(3000);

    // 切换到密码登录
    // 注意：页面上有两个"密码登录" span（测量用），还有一个可点击的 div.ds-button
    console.log("[auto] 查找密码登录按钮...");
    let pwdLoginBtn = page.locator('div.ds-button:has-text("密码登录")').first();
    if ((await pwdLoginBtn.count()) === 0) {
      pwdLoginBtn = page.locator('button:has-text("密码登录"), [role="button"]:has-text("密码登录")').first();
    }
    if ((await pwdLoginBtn.count()) === 0) {
      // fallback: JS click on the social-link span's parent
      pwdLoginBtn = page.locator('span.ds-sign-in-form__social-link-measure:has-text("密码登录")');
      if ((await pwdLoginBtn.count()) > 0) {
        console.log("[auto] 使用 JS 点击密码登录...");
        await pwdLoginBtn.evaluate(el => el.parentElement?.click() || el.click());
      }
    } else {
      console.log("[auto] 点击密码登录...");
      try { await pwdLoginBtn.click(); } catch { await pwdLoginBtn.evaluate(el => el.click()); }
    }
    if ((await pwdLoginBtn.count()) > 0) await page.waitForTimeout(2000);

    // 填写手机号
    console.log("[auto] 查找手机号输入框...");
    let phoneInput = page.locator('input[placeholder*="手机号/邮箱地址"]').first();
    if ((await phoneInput.count()) === 0) {
      phoneInput = page.locator('input[placeholder*="请输入手机号"]').first();
    }
    if ((await phoneInput.count()) === 0) {
      phoneInput = page.locator('input[type="tel"]').first();
    }
    if ((await phoneInput.count()) > 0) {
      console.log("[auto] 填写手机号...");
      await phoneInput.click();
      await phoneInput.fill(CONFIG.autoLogin.phone);
      await phoneInput.press("Tab");
    } else {
      console.log("[auto] 未找到手机号输入框");
      return false;
    }

    // 填写密码
    console.log("[auto] 查找密码输入框...");
    let pwdInput = page.locator('input[placeholder*="密码"]').first();
    if ((await pwdInput.count()) === 0) {
      pwdInput = page.locator('input[type="password"]').first();
    }
    if ((await pwdInput.count()) === 0) {
      console.log("[auto] 未找到密码输入框");
      return false;
    }
    console.log("[auto] 填写密码...");
    await pwdInput.click();
    await pwdInput.fill(CONFIG.autoLogin.password);
    await page.waitForTimeout(500);

    // 提交登录：优先使用 Enter（比 button.click 更可靠），button.click 作为 fallback
    console.log("[auto] 提交登录...");
    try {
      await page.keyboard.press("Enter");
    } catch {
      const loginBtn = page.locator('div.ds-button:has-text("登录")').first();
      if ((await loginBtn.count()) > 0) await loginBtn.click();
    }

    // 轮询等待登录完成（URL 变化或出现聊天输入框）
    console.log("[auto] 等待登录结果...");
    let loggedIn = false;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(500);
      const url = page.url();
      if (url.includes("/chat/")) { loggedIn = true; break; }
      const chatInput = await page.locator('textarea[placeholder*="发送消息"]').first();
      if ((await chatInput.count()) > 0) { loggedIn = true; break; }
      if (!/\/sign_in/.test(url) && !/\/login/.test(url)) { loggedIn = true; break; }
    }
    const currentUrl = page.url();
    console.log("[auto] 当前 URL:", currentUrl);
    if (loggedIn) return true;
    console.log("[auto] 登录未成功，仍在登录页");
    return false;
  } catch (e) {
    console.log("[auto] 异常:", e.message);
    return false;
  }
}

// ========================
// 模式切换 + Toggle 控制
// ========================
async function switchMode(mode) {
  const modeMap = { fast: SEL.modeFast, expert: SEL.modeExpert, vision: SEL.modeVision };
  const selector = modeMap[mode];
  if (!selector) return;
  try {
    const btn = state.page.locator(selector).first();
    if ((await btn.count()) > 0) {
      await btn.click();
      await state.page.waitForTimeout(200);
    }
  } catch (e) {
    console.log("[WARN] 切换模式失败:", e.message);
  }
  await setToggles(mode);
  state.currentMode = mode;
}

// 控制 DeepSeek 的 toggle 按钮
async function setToggles(mode) {
  try {
    // 深度思考：三模式均默认开启
    const deepThink = state.page.locator(SEL.toggleDeepThink).first();
    if ((await deepThink.count()) > 0) {
      const isSelected = await deepThink.evaluate((el) => el.classList.contains("ds-toggle-button--selected"));
      if (!isSelected) await deepThink.click();
    }

    // 智能搜索：仅快速模式开启
    const webSearch = state.page.locator(SEL.toggleWebSearch).first();
    if ((await webSearch.count()) > 0) {
      const isSelected = await webSearch.evaluate((el) => el.classList.contains("ds-toggle-button--selected"));
      if (mode === "fast" && !isSelected) await webSearch.click();
      if (mode !== "fast" && isSelected) await webSearch.click();
    }
  } catch (e) {
    // toggle 控制失败不影响主流程
  }
}

module.exports = {
  ensureBrowser,
  closeBrowser,
  doLogin,
  tryAutoLogin,
  switchMode,
  setToggles,
  SEL,
};
