// ========================
// 守护进程
// ========================
const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawn } = require("child_process");
const { ensureBrowser } = require("./browser");
const { chat, exportConversation } = require("./chat");
const { listHistory, deleteHistory, createNewChat } = require("./history");
const { state } = require("./state");

const PID_FILE = path.join(os.tmpdir(), "deepseek-daemon.pid");
const PORT_FILE = path.join(os.tmpdir(), "deepseek-daemon.port");
const DAEMON_SCRIPT = path.join(__dirname, "..", "deepseek-ai.js");
// Windows 后台启动辅助脚本（解决 VBScript/PowerShell 引号转义问题）
const HELPER_SCRIPT = path.join(__dirname, "start-daemon.js");

// 检查 PID 文件中的进程是否存活
function isDaemonAlive() {
  try {
    if (!fs.existsSync(PID_FILE)) return false;
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    if (!pid) return false;
    // 跨平台检测：signal 0 不杀进程，仅检查是否存在
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 读取 PID 文件
function readPidFile() {
  try {
    if (fs.existsSync(PID_FILE)) {
      return parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    }
  } catch {}
  return null;
}

// 清理 PID 文件
function removePidFile() {
  try { fs.unlinkSync(PID_FILE); } catch {}
  try { fs.unlinkSync(PORT_FILE); } catch {}
}

// 读取守护进程端口
function getDaemonPort() {
  try {
    if (fs.existsSync(PORT_FILE)) {
      return parseInt(fs.readFileSync(PORT_FILE, "utf8").trim(), 10);
    }
  } catch {}
  return null;
}

// 启动 TCP 服务器（不写 port 文件，等浏览器就绪后再写）
function startTcpServer(port) {
  const net = require("net");
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", async (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const cmd = JSON.parse(line);
          const result = await handleCommandRaw(cmd);
          socket.write(JSON.stringify(result) + "\n");
        } catch (e) {
          socket.write(JSON.stringify({ error: e.message }) + "\n");
        }
      }
    });
    socket.on("error", () => {});
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

// 处理命令（纯函数，不输出到 stdout）
async function handleCommandRaw(cmd) {
  const listHistoryFn = listHistory;
  try {
    if (!state.page || state.page.isClosed()) {
      return { ok: false, error: "浏览器未就绪" };
    }
    switch (cmd.action) {
      case "chat": {
        const responses = await chat(cmd.messages || [], cmd.chat, cmd.mode || "fast", cmd.files || [], cmd.stream || false, false, listHistoryFn);
        return { ok: true, responses, stream: cmd.stream || false };
      }
      case "list": {
        const history = await listHistory();
        return { ok: true, history };
      }
      case "new": {
        const result = await createNewChat();
        if (cmd.messages && cmd.messages.length > 0) {
          const responses = await chat(cmd.messages, null, cmd.mode || "fast", cmd.files || [], cmd.stream || false, false, listHistoryFn);
          return { ok: true, responses, sessionId: result.sessionId, url: result.url };
        }
        return { ok: true, sessionId: result.sessionId, url: result.url };
      }
      case "continue": {
        const responses = await chat([], null, cmd.mode || "fast", cmd.files || [], cmd.stream || false, true, listHistoryFn);
        return { ok: true, responses, stream: cmd.stream || false };
      }
      case "delete": {
        await deleteHistory(cmd.index);
        return { ok: true };
      }
      case "export": {
        const md = await exportConversation();
        return { ok: true, text: md };
      }
      case "mode": {
        const { switchMode } = require("./browser");
        await switchMode(cmd.mode || "fast");
        return { ok: true };
      }
      default:
        return { ok: false, error: "未知命令: " + cmd.action };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 启动守护进程（创建完全独立的后台进程）
async function startDaemon() {
  const oldPid = readPidFile();
  if (oldPid) {
    try { process.kill(oldPid, "SIGTERM"); } catch {}
    // 等待旧进程彻底退出，避免 PID  reused
    await new Promise(r => setTimeout(r, 500));
    removePidFile();
  }

  if (process.platform !== "win32") {
    return new Promise((resolve) => {
      try {
        const child = spawn(process.execPath, [DAEMON_SCRIPT, "--daemon"], {
          detached: true, stdio: ["ignore", "ignore", "ignore"],
        });
        child.unref();
        let waited = 0;
        const timer = setInterval(() => {
          waited += 500;
          if (readPidFile() && getDaemonPort() && isDaemonAlive()) { clearInterval(timer); resolve(true); }
          else if (waited > 60000) { clearInterval(timer); resolve(false); }
        }, 500);
      } catch { resolve(false); }
    });
  }

  // Windows: 通过辅助脚本启动，避免 VBScript/PowerShell 引号转义问题
  return new Promise((resolve) => {
    try {
      const child = spawn(process.execPath, [HELPER_SCRIPT], {
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
      });
      child.on("error", () => resolve(false));
      child.unref();

      let waited = 0;
      const timer = setInterval(() => {
        waited += 500;
        const pid = readPidFile();
        const port = getDaemonPort();
        if (pid && port && isDaemonAlive()) {
          clearInterval(timer);
          resolve(true);
        } else if (waited > 60000) {
          clearInterval(timer);
          resolve(false);
        }
      }, 500);
    } catch { resolve(false); }
  });
}

// 守护进程主循环（由 --daemon 参数直接调用）
async function runDaemon() {
  // 清理可能残留的旧文件（前次崩溃等情况）
  removePidFile();

  process.on("exit", removePidFile);
  process.on("SIGINT", () => { removePidFile(); process.exit(0); });
  process.on("SIGTERM", () => { removePidFile(); process.exit(0); });
  process.on("uncaughtException", (e) => { console.error("[FATAL]", e.message); removePidFile(); process.exit(1); });

  try {
    const tcpServer = await startTcpServer(0);
    console.error("[*] DeepSeek AI 守护进程启动中...");
    await ensureBrowser();
    console.error("[*] 浏览器已就绪");

    // 浏览器就绪后才写入 PID + port 文件，防止客户端提前连接
    try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch {}
    try { fs.writeFileSync(PORT_FILE, String(tcpServer.address().port)); } catch {}
    process.stdout.write("READY\n");

    // 永久挂起：TCP 服务器在后台处理连接
    await new Promise(() => {});
  } catch (e) {
    console.error("[FATAL] 守护进程异常:", e.message);
    removePidFile();
    process.exit(1);
  }
}

module.exports = {
  runDaemon,
  isDaemonAlive,
  PID_FILE,
  PORT_FILE,
  readPidFile,
  getDaemonPort,
  startDaemon,
  removePidFile,
  handleCommandRaw,
};
