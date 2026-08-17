// ========================
// 历史对话管理
// ========================
const { state } = require("./state");
const { SEL } = require("./browser");

// 列出历史对话
async function listHistory(silent = false) {
  await state.page.goto("https://chat.deepseek.com", { waitUntil: "domcontentloaded", timeout: 30000 });
  await state.page.waitForSelector('a[href*="/a/chat/s/"]', { timeout: 15000 }).catch(() => {});

  const history = await state.page.evaluate(() => {
    const map = new Map();
    document.querySelectorAll('a[href*="/a/chat/s/"]').forEach((el) => {
      const text = (el.innerText || el.textContent || "").trim();
      const href = el.getAttribute("href") || "";
      const rect = el.getBoundingClientRect();
      if (text.length > 0 && rect.x < 350) {
        const match = href.match(/\/s\/([a-f0-9-]+)/);
        if (match && !map.has(match[1])) {
          map.set(match[1], { title: text.substring(0, 80), sessionId: match[1] });
        }
      }
    });
    return [...map.values()];
  });

  if (!silent) {
    console.log("\n历史对话列表：\n");
    history.forEach((item, i) => {
      console.log(`  [${i + 1}] ${item.title}`);
    });
    console.log(`\n共 ${history.length} 条对话`);
  }
  return history;
}

// 删除历史对话
async function deleteHistory(index) {
  const history = await listHistory();
  if (index < 1 || index > history.length) {
    console.log(`[ERROR] 索引 ${index} 超出范围 (1-${history.length})`);
    return;
  }
  const target = history[index - 1];
  console.log(`[*] 删除对话: ${target.title}`);

  // 导航到对话页，侧边栏加载后找到对应项并删除
  await state.page.goto(`https://chat.deepseek.com/a/chat/s/${target.sessionId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await state.page.waitForTimeout(1500);

  // 通过侧边栏找到该对话的删除按钮（点击更多菜单 → 删除）
  const moreClicked = await state.page.evaluate((sessionId) => {
    const links = document.querySelectorAll('a[href*="/a/chat/s/"]');
    for (const el of links) {
      const href = el.getAttribute("href") || "";
      if (href.includes(sessionId)) {
        const moreBtn = el.querySelector('div._254829d div[role="button"]');
        if (!moreBtn) return false;
        moreBtn.click();
        return true;
      }
    }
    return false;
  }, target.sessionId);

  if (!moreClicked) {
    console.log("[!] 未找到更多按钮，请手动删除");
    return;
  }

  // 等待下拉菜单出现
  await state.page.waitForTimeout(300);
  // 验证更多菜单是否真的打开（检查是否有删除选项）
  const hasDeleteOption = await state.page.locator("div.ds-dropdown-menu-option--error").first().count();
  if (hasDeleteOption === 0) {
    console.log("[!] 更多菜单未打开，请手动删除");
    return;
  }
  // 点击删除选项
  await state.page.locator("div.ds-dropdown-menu-option--error").first().click();
  await state.page.waitForTimeout(300);
  // 点击确认弹窗中的"删除该对话"按钮（div.ds-button--error + ds-button--filled，红色背景）
  await state.page.locator("div.ds-button--error.ds-button--filled:has-text('删除该对话')").first().click().catch(() => {});
  await state.page.waitForTimeout(1500);

  // 验证删除是否成功：重新加载页面检查会话是否还在
  await state.page.goto("https://chat.deepseek.com", { waitUntil: "domcontentloaded", timeout: 30000 });
  await state.page.waitForSelector('a[href*="/a/chat/s/"]', { timeout: 15000 }).catch(() => {});
  const stillExists = await state.page.evaluate((sessionId) => {
    return Array.from(document.querySelectorAll('a[href*="/a/chat/s/"]')).some((el) => (el.getAttribute("href") || "").includes(sessionId));
  }, target.sessionId);

  if (stillExists) {
    console.log("[!] 删除可能未成功，请手动确认");
  } else {
    console.log("[OK] 已删除");
  }
}

// 新建对话
async function createNewChat() {
  await state.page.goto("https://chat.deepseek.com", { waitUntil: "domcontentloaded", timeout: 30000 });
  await state.page.waitForSelector(SEL.textarea, { timeout: 15000 }).catch(() => {});

  const finalUrl = state.page.url();
  let sessionId = "";
  const match = finalUrl.match(/\/chat\/([a-f0-9-]+)/);
  if (match) sessionId = match[1];

  console.log(`[*] 新建对话: ${finalUrl}`);
  if (!sessionId) {
    console.log("[!] 请在页面中发送消息以创建会话");
  }
  return { sessionId, url: finalUrl };
}

module.exports = { listHistory, deleteHistory, createNewChat };
