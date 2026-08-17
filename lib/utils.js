// ========================
// 工具函数
// ========================

/**
 * 指数退避重试（仅对超时和网络错误重试）
 */
async function withRetry(fn, label = "") {
  const CONFIG = require("./state").CONFIG;
  const { maxAttempts, baseDelay, maxDelay } = CONFIG.retry;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = e?.message || "";
      const isTimeout = msg.toLowerCase().includes("timeout");
      const isNetwork = /net|econnrefused|socket hang up|enet unreachable/i.test(msg);
      if (!isTimeout && !isNetwork && attempt < maxAttempts) throw e;
      if (attempt === maxAttempts) break;
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      console.log(`[RETRY] ${label} 第${attempt}次失败，${delay}ms后重试... (${msg})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr || new Error(`${label}: 未知错误`);
}

// ========================
// 帮助信息
// ========================
function showHelp() {
  console.log(`DeepSeek AI 自动对话工具

用法：
  node deepseek-ai.js "消息内容"                    （快速模式，发消息）
  node deepseek-ai.js --daemon                      （守护进程模式）
  node deepseek-ai.js --help                        （显示此帮助）

参数：
  --mode <模式>       对话模式：fast（默认）/ expert / vision
  --file <路径>       上传文件（快速模式/识图模式，专家模式不支持）
  --chat <目标>       复用历史对话：序号 / 标题 / sessionId
  --list              列出所有历史对话
  --new               新建对话
  --delete <序号>     删除第 N 条历史对话
  --export            导出当前对话为 Markdown
  --continue          继续最近一次对话（保持上下文）
  --stream            流式输出（逐增量显示回复）
  --daemon            启动守护进程（浏览器持久运行，stdin 接收命令）
  --close             关闭浏览器
  --help / -h         显示帮助信息

  --                  参数终止符，后面的内容全部当作消息

对话模式：
  fast      快速模式（默认），默认开启深度思考，支持联网搜索
  expert    专家模式，默认开启深度思考，不支持联网搜索
  vision    识图模式，默认开启深度思考，支持图片/文档理解，不支持联网搜索

深度思考：三模式均默认开启，无需手动设置
联网搜索：仅快速模式支持

连续对话：
  --continue "第一条消息"    自动续接最近一次对话
  --continue "第二条消息"    上下文连续保持
  --daemon                  守护进程内多次 chat 自动保持上下文

守护进程命令（stdin JSON）：
  {"action":"chat","messages":["内容"],"mode":"fast"}
  {"action":"chat","messages":["内容"],"mode":"expert"}
  {"action":"chat","messages":["内容"],"mode":"vision","files":["路径"],"stream":true}
  {"action":"list"}
  {"action":"mode","mode":"expert"}
  {"action":"new"}
  {"action":"continue"}
  {"action":"delete","index":3}
  {"action":"export"}
  {"action":"close"}

  或直接输入纯文本（自动作为 fast 模式消息发送）

配置：
  凭据和参数通过 config.json 或环境变量配置，不硬编码在源码中。
  优先级：环境变量 > config.json > 默认值

  环境变量：
    DEEPSEEK_PHONE          登录手机号
    DEEPSEEK_PASSWORD       登录密码
    DEEPSEEK_AUTO_LOGIN      false 禁用自动登录
    DEEPSEEK_RESPONSE_TIMEOUT  回复超时（ms，默认 120000）
`);
}

// ========================
// 参数解析
// ========================
function parseMessages(args) {
  const messages = [];
  // 需要跳过后值的 flag（如 --mode fast 中的 --mode）
  const valueSkipFlags = new Set(["--mode", "--file", "--chat"]);
  // 纯开关 flag（跳过自身即可）
  const boolFlags = new Set(["--stream", "--continue", "--list", "--new", "--delete", "--export", "--daemon", "--close"]);

  for (let i = 0; i < args.length; i++) {
    if (valueSkipFlags.has(args[i])) { i++; continue; } // 跳过 flag + 值
    if (boolFlags.has(args[i])) continue; // 跳过纯开关 flag
    if (args[i] === "--") { i++; break; }
    if (args[i].startsWith("-")) continue;
    messages.push(args[i]);
  }
  return messages;
}

function getChatTarget(args) {
  const idx = args.indexOf("--chat");
  if (idx === -1 || idx + 1 >= args.length) return null;
  const val = args[idx + 1];
  const num = parseInt(val, 10);
  return isNaN(num) ? val : num;
}

module.exports = { withRetry, showHelp, parseMessages, getChatTarget };
