// ========================
// 对话流程（发送 + 等待回复 + 导出）
// ========================
const { CONFIG, state } = require("./state");
const { withRetry } = require("./utils");
const { SEL, switchMode } = require("./browser");

// ---- 发送消息 + 等待回复 ----

async function sendAndWait(page, message) {
  const textarea = await page.locator(SEL.textarea).first();
  await textarea.click();
  await textarea.fill("");
  await textarea.type(message, { delay: 20 });

  // 快照发送前所有回复的文本，发送后通过文本变化识别新回复
  const existingTexts = new Set(
    (await page.locator(SEL.response).allTextContents()).map((t) => t.trim())
  );

  await page.keyboard.press("Enter");

  // 等待回复文本稳定（连续 3 次无变化，1.5 秒视为完成）
  await waitForResponseStable(page, existingTexts);

  // 从所有回复中找到不属于 existingTexts 的新回复
  const allTexts = await page.locator(SEL.response).allTextContents();
  const newText = allTexts.find((t) => !existingTexts.has(t.trim())) || allTexts[allTexts.length - 1] || "";
  return { full: newText.trim(), reasoning: "", tokens: null };
}

// 等待新回复出现并稳定（连续 3 次无变化，0.6 秒视为完成）
async function waitForResponseStable(page, existingTexts) {
  await new Promise((resolve, reject) => {
    const POLL_INTERVAL = 200;
    const STABLE_THRESHOLD = 3; // 连续 3 次无变化（0.6 秒）
    const MAX_WAIT = CONFIG.responseTimeout;

    let stableCount = 0;
    let lastLen = 0;
    const startTime = Date.now();

    const timer = setInterval(async () => {
      try {
        // 找到不属于 existingTexts 的新回复，取其长度
        const allTexts = await page.locator(SEL.response).allTextContents();
        let currentLen = 0;
        for (const t of allTexts) {
          const trimmed = t.trim();
          if (trimmed.length > 0 && !existingTexts.has(trimmed)) {
            currentLen = trimmed.length;
            break;
          }
        }
        if (currentLen > 0 && currentLen === lastLen) {
          stableCount++;
          if (stableCount >= STABLE_THRESHOLD) {
            clearInterval(timer);
            resolve();
          }
        } else if (currentLen > 0) {
          stableCount = 0;
          lastLen = currentLen;
        }
        if (Date.now() - startTime > MAX_WAIT) {
          clearInterval(timer);
          if (lastLen > 0) resolve();
          else reject(new Error("等待回复超时"));
        }
      } catch (e) {
        clearInterval(timer);
        reject(e);
      }
    }, POLL_INTERVAL);
  });
}

// ========================
// 流式发送（DOM 轮询，增量输出）
// ========================
async function sendAndWaitStream(page, message) {
  const textarea = await page.locator(SEL.textarea).first();
  await textarea.click();
  await textarea.fill("");
  await textarea.type(message, { delay: 20 });

  // 快照发送前所有回复的文本
  const existingTexts = new Set(
    (await page.locator(SEL.response).allTextContents()).map((t) => t.trim())
  );

  await page.keyboard.press("Enter");

  // DOM 轮询：检测新回复文本增量并实时输出
  let lastNewText = "";
  let stableCount = 0;
  const STREAM_INTERVAL = 200;
  const STREAM_STABLE = 6; // 连续 6 次（1.2 秒）无变化视为完成
  const MAX_NO_CHANGE_MS = 30000; // 单次无变化超 30 秒强制完成
  let noChangeStart = Date.now();

  return new Promise((resolve, reject) => {
    const streamTimer = setInterval(async () => {
      try {
        // 找到不属于 existingTexts 的新回复
        const allTexts = await page.locator(SEL.response).allTextContents();
        let currentNewText = "";
        for (const t of allTexts) {
          const trimmed = t.trim();
          if (trimmed.length > 0 && !existingTexts.has(trimmed)) {
            currentNewText = trimmed;
            break;
          }
        }
        if (currentNewText && currentNewText !== lastNewText) {
          // 增量输出
          const delta = currentNewText.substring(lastNewText.length);
          if (delta) process.stdout.write(delta);
          lastNewText = currentNewText;
          stableCount = 0;
          noChangeStart = Date.now();
        } else {
          stableCount++;
        }
        // 完成条件：连续 4 秒无变化 或 单次无变化超 30 秒
        const noChangeMs = Date.now() - noChangeStart;
        if (stableCount >= STREAM_STABLE || noChangeMs > MAX_NO_CHANGE_MS) {
          clearInterval(streamTimer);
          process.stdout.write(` [${lastNewText.length}字]\n`);
          resolve({ full: lastNewText, reasoning: "", tokens: null });
        }
      } catch (e) {
        clearInterval(streamTimer);
        reject(e);
      }
    }, STREAM_INTERVAL);
  });
}

// ========================
// 文件上传
// ========================
async function uploadFiles(page, filePaths) {
  if ((await page.locator('input[type="file"]').first().count()) > 0) {
    await page.locator('input[type="file"]').first().setInputFiles(filePaths);
    await page.waitForTimeout(1000);
  }
}

// ========================
// 主对话流程
// ========================
async function chat(messages, chatTarget = null, mode = "fast", files = [], stream = false, contin = false, listHistoryFn) {
  // 确定目标对话（只获取一次历史，避免多次导航）
  let effectiveTarget = chatTarget;
  let historyCache = null;
  const getHistory = async () => {
    if (!historyCache) historyCache = await listHistoryFn(true);
    return historyCache;
  };

  if (contin) {
    const history = await getHistory();
    if (history.length > 0) {
      effectiveTarget = history[0].sessionId;
      console.log(`[*] 继续对话: ${history[0].title}`);
    } else {
      console.log("[!] 无历史对话，将创建新对话");
    }
  }

  // 复用对话：导航到指定会话
  if (effectiveTarget) {
    let targetSession = null;
    if (typeof effectiveTarget === "number") {
      const history = await getHistory();
      targetSession = history[effectiveTarget - 1];
    } else if (/^[a-f0-9-]+$/i.test(effectiveTarget)) {
      targetSession = { sessionId: effectiveTarget, title: effectiveTarget };
    } else {
      const history = await getHistory();
      targetSession = history.find((h) => h.title === effectiveTarget || h.title.includes(effectiveTarget));
    }

    if (!targetSession) {
      console.log(`[!] 未找到对话: ${effectiveTarget}`);
      return [];
    }
    console.log(`[*] 复用对话: ${targetSession.title}`);
    await state.page.goto(`https://chat.deepseek.com/a/chat/s/${targetSession.sessionId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await state.page.waitForSelector(SEL.textarea, { timeout: 15000 }).catch(() => {});
  } else {
    // 非复用模式：只在模式变化或首次时导航
    if (!state.browserStarted || state.currentMode !== mode) {
      await state.page.goto("https://chat.deepseek.com", { waitUntil: "domcontentloaded", timeout: 30000 });
      await state.page.waitForSelector(SEL.textarea, { timeout: 15000 }).catch(() => {});
      await switchMode(mode);
    }
  }

  console.log("[*] 页面:", state.page.url());
  console.log("[*] 模式:", mode === "fast" ? "快速模式" : mode === "expert" ? "专家模式" : "识图模式");

  if (files.length > 0 && mode !== "expert") {
    console.log(`[*] 上传 ${files.length} 个文件`);
    await uploadFiles(state.page, files);
  }

  const responses = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    console.log(`\n[${i + 1}/${messages.length}] 发送: ${msg.substring(0, 60)}${msg.length > 60 ? "..." : ""}`);
    if (stream) {
      console.log("[流式] ");
      const reply = await sendAndWaitStream(state.page, msg);
      responses.push(reply);
    } else {
      const reply = await withRetry(
        () => sendAndWait(state.page, msg),
        `消息${i + 1}`
      );
      responses.push(reply);
      const text = reply.full ?? "";
      console.log(`  回复: ${text.substring(0, 100)}${text.length > 100 ? "..." : ""}`);
    }
    if (i < messages.length - 1) await state.page.waitForTimeout(CONFIG.messageInterval);
  }
  return responses;
}

// ========================
// Markdown 导出
// ========================
async function exportConversation() {
  const data = await state.page.evaluate(() => {
    const messages = [];

    // AI 回复
    const aiEls = document.querySelectorAll("div.ds-markdown.ds-assistant-message-main-content");
    // 用户消息：div.ds-message 但不包含 ds-markdown 子元素
    const userEls = document.querySelectorAll("div.ds-message:not(:has(div.ds-markdown))");

    // 按 DOM 顺序排列
    const allEls = [];
    userEls.forEach((el) => allEls.push({ role: "user", el }));
    aiEls.forEach((el) => allEls.push({ role: "assistant", el }));

    // 按文档顺序排序
    allEls.sort((a, b) => {
      const pos = a.el.compareDocumentPosition(b.el);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    for (const { role, el } of allEls) {
      const reasoning = el.querySelector("details")?.innerText?.trim() || "";
      const content = (el.innerText || el.textContent || "").trim();
      if (content.length > 0) {
        messages.push({ role, content, reasoning });
      }
    }

    return { messages, url: location.href, title: document.title };
  });

  if (data.messages.length === 0) {
    return "# 空对话\n\n当前页面未找到对话内容。";
  }

  const lines = [`# ${data.title || "DeepSeek 对话导出"}`, "", `> 导出时间: ${new Date().toLocaleString("zh-CN")}`, `> 来源: ${data.url}`, ""];

  for (const msg of data.messages) {
    if (msg.role === "user") {
      lines.push(`## 用户`, "", msg.content, "");
    } else {
      if (msg.reasoning) {
        lines.push(`## AI 回复`, "", "### 推理过程", "", "```", msg.reasoning, "```", "", "### 最终答案", "", msg.content, "");
      } else {
        lines.push(`## AI 回复`, "", msg.content, "");
      }
    }
    lines.push("---", "");
  }

  return lines.join("\n");
}

module.exports = { chat, exportConversation };
