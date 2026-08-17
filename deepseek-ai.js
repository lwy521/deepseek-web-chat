/**
 * DeepSeek AI 对话工具（全自动）
 *
 * 模块拆分：
 *   lib/state.js    - 配置 + 共享状态
 *   lib/browser.js  - 浏览器管理、登录、模式切换
 *   lib/chat.js     - 对话流程、发送等待、导出
 *   lib/history.js  - 历史对话管理
 *   lib/daemon.js   - 守护进程
 *   lib/client.js   - 守护进程客户端
 *   lib/utils.js    - 工具函数
 */

const fs = require("fs");
const path = require("path");
const { ensureBrowser, closeBrowser } = require("./lib/browser");
const { chat, exportConversation } = require("./lib/chat");
const { listHistory, deleteHistory, createNewChat } = require("./lib/history");
const { runDaemon } = require("./lib/daemon");
const { ensureDaemon, sendToDaemon } = require("./lib/client");
const { showHelp, parseMessages, getChatTarget } = require("./lib/utils");

// ========================
// 主入口
// ========================
(async () => {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  if (args.includes("--close")) {
    // 关闭守护进程
    const { PID_FILE, removePidFile } = require("./lib/daemon");
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
      if (pid) {
        try { process.kill(pid, "SIGTERM"); } catch {}
        // SIGTERM 在 Windows 上不触发清理回调，手动清理
        removePidFile();
        console.log("[OK] 守护进程已关闭");
      } else {
        console.log("[INFO] 无运行中的守护进程");
      }
    } catch {
      console.log("[INFO] 无运行中的守护进程");
      removePidFile();
    }
    process.exit(0);
  }

  // 守护进程模式：直接运行
  if (args.includes("--daemon")) {
    await runDaemon();
    return;
  }

  // 其他命令：尝试通过守护进程复用浏览器
  const daemonAvailable = await ensureDaemon();
  let useDaemon = false;
  if (daemonAvailable) {
    try {
      // 用一条轻量命令测试守护进程是否可用
      const testResult = await sendToDaemon({ action: "list" });
      useDaemon = true;
    } catch {
      useDaemon = false;
    }
  }

  if (args.includes("--list")) {
    if (useDaemon) {
      const result = await sendToDaemon({ action: "list" });
      if (result.error) { console.error("[ERROR]", result.error); process.exit(1); }
      if (result.history && result.history.length > 0) {
        console.log("\n历史对话列表：\n");
        result.history.forEach((item, i) => {
          console.log(`  [${i + 1}] ${item.title}`);
        });
        console.log(`\n共 ${result.history.length} 条对话`);
      } else {
        console.log("（无历史对话）");
      }
    } else {
      await ensureBrowser();
      await listHistory();
      await closeBrowser();
    }
    process.exit(0);
  }

  if (args.includes("--new")) {
    await ensureBrowser();
    const result = await createNewChat();
    const newIdx = args.indexOf("--new");
    const newMsgs = [];
    const valueSkipFlags = new Set(["--mode", "--file", "--chat"]);
    let i = newIdx + 1;
    while (i < args.length) {
      if (args[i] === "--") { i++; break; }
      if (valueSkipFlags.has(args[i])) { i += 2; continue; }
      if (args[i].startsWith("-")) { i++; continue; }
      newMsgs.push(args[i]);
      i++;
    }
    if (newMsgs.length > 0) {
      const newMode = args.includes("--mode expert") ? "expert" : args.includes("--mode vision") ? "vision" : "fast";
      const newStream = args.includes("--stream");
      const responses = await chat(newMsgs, null, newMode, [], newStream, false, listHistory);
      if (responses.length > 0 && !newStream) {
        console.log("\n=== AI_REPLIES ===");
        responses.forEach((r, i) => { const t = r.full ?? ""; console.log(`--- REPLY_${i + 1} ---\n${t}\n`); });
        console.log("=== END ===");
      }
    } else {
      console.log(JSON.stringify({ sessionId: result.sessionId, url: result.url }, null, 2));
    }
    await closeBrowser();
    process.exit(0);
  }

  const deleteIdx = args.indexOf("--delete");
  if (deleteIdx !== -1 && deleteIdx + 1 < args.length) {
    if (useDaemon) {
      const result = await sendToDaemon({ action: "delete", index: parseInt(args[deleteIdx + 1], 10) });
      if (result.error) { console.error("[ERROR]", result.error); }
    } else {
      await ensureBrowser();
      await deleteHistory(parseInt(args[deleteIdx + 1], 10));
      await closeBrowser();
    }
    process.exit(0);
  }

  if (args.includes("--export")) {
    if (useDaemon) {
      const chatTarget = getChatTarget(args);
      if (chatTarget !== null) {
        await sendToDaemon({ action: "chat", chat: chatTarget, messages: [], mode: "fast" });
      }
      const result = await sendToDaemon({ action: "export" });
      if (result.error) { console.error("[ERROR]", result.error); }
      else if (result.text) console.log(result.text);
    } else {
      await ensureBrowser();
      const chatTarget = getChatTarget(args);
      if (chatTarget !== null) {
        const history = await listHistory(true);
        let targetSession = null;
        if (typeof chatTarget === "number") {
          targetSession = history[chatTarget - 1];
        } else if (/^[a-f0-9-]+$/i.test(chatTarget)) {
          targetSession = { sessionId: chatTarget, title: chatTarget };
        } else {
          targetSession = history.find((h) => h.title === chatTarget || h.title.includes(chatTarget));
        }
        if (targetSession) {
          const { state } = require("./lib/state");
          await state.page.goto(`https://chat.deepseek.com/a/chat/s/${targetSession.sessionId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
          await state.page.waitForTimeout(2000);
        }
      }
      const md = await exportConversation();
      console.log(md);
      await closeBrowser();
    }
    process.exit(0);
  }

  // 普通对话模式
  let mode = "fast";
  const modeIdx = args.indexOf("--mode");
  if (modeIdx !== -1 && args[modeIdx + 1]) {
    mode = args[modeIdx + 1];
    if (!["fast", "expert", "vision"].includes(mode)) { console.error(`未知模式: ${mode}`); process.exit(1); }
  }

  let files = [];
  const fileIdx = args.indexOf("--file");
  if (fileIdx !== -1 && args[fileIdx + 1] && fs.existsSync(args[fileIdx + 1])) {
    files = [path.resolve(args[fileIdx + 1])];
  }

  const stream = args.includes("--stream");
  const contin = args.includes("--continue");

  const chatTarget = getChatTarget(args);
  let messages = [];
  if (chatTarget !== null) {
    const chatIdx = args.indexOf("--chat");
    const valueSkipFlags = new Set(["--mode", "--file"]);
    let i = chatIdx + 2;
    while (i < args.length) {
      if (args[i] === "--") { i++; break; }
      if (valueSkipFlags.has(args[i])) { i += 2; continue; }
      if (args[i].startsWith("-")) { i++; continue; }
      messages.push(args[i]);
      i++;
    }
  } else {
    messages = parseMessages(args);
  }
  if (messages.length === 0 && files.length === 0 && !contin) {
    console.log("用法：node deepseek-ai.js \"消息\" [--mode fast|expert|vision] [--file path] [--stream]");
    console.log("      node deepseek-ai.js --continue          （继续最近对话）");
    console.log("      node deepseek-ai.js --new                （新建对话）");
    console.log("      node deepseek-ai.js --delete <序号>      （删除对话）");
    console.log("      node deepseek-ai.js --export             （导出 Markdown）");
    console.log("      node deepseek-ai.js --daemon             （启动守护进程）");
    process.exit(1);
  }

  if (useDaemon && !stream) {
    // 通过守护进程发送（复用浏览器）
    // 流式模式 bypass 守护进程：直接执行以保留终端实时增量输出
    const cmd = {
      action: "chat",
      messages,
      chat: chatTarget,
      mode,
      files,
      stream: false,
    };
    const result = await sendToDaemon(cmd);
    if (result.error) {
      console.error("[ERROR]", result.error);
      process.exit(1);
    }
    if (result.responses && result.responses.length > 0) {
      console.log("\n=== AI_REPLIES ===");
      result.responses.forEach((r, i) => {
        const t = r.full ?? "";
        console.log(`--- REPLY_${i + 1} ---\n${t}\n`);
      });
      console.log("=== END ===");
    }
  } else {
    // 普通模式（直接执行）
    await ensureBrowser();
    const responses = await chat(messages, chatTarget, mode, files, stream, contin, listHistory);
    if (!stream) {
      console.log("\n=== AI_REPLIES ===");
      responses.forEach((r, i) => { const t = r.full ?? ""; console.log(`--- REPLY_${i + 1} ---\n${t}\n`); });
      console.log("=== END ===");
    }
    await closeBrowser();
  }
})();
