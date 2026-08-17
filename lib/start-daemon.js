// ========================
// Windows 守护进程启动辅助脚本
// 由 lib/daemon.js 通过 spawn 调用，独立启动守护进程并等待 PID/port 文件就绪
// ========================
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const PID_FILE = path.join(os.tmpdir(), "deepseek-daemon.pid");
const PORT_FILE = path.join(os.tmpdir(), "deepseek-daemon.port");
const DAEMON_SCRIPT = path.join(__dirname, "..", "deepseek-ai.js");

async function waitForFiles(timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fs.existsSync(PID_FILE) && fs.existsSync(PORT_FILE)) {
      const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
      const port = parseInt(fs.readFileSync(PORT_FILE, "utf8").trim(), 10);
      if (pid && port) {
        try { process.kill(pid, 0); return { pid, port }; } catch {}
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

async function main() {
  // 清理旧状态
  try { fs.unlinkSync(PID_FILE); } catch {}
  try { fs.unlinkSync(PORT_FILE); } catch {}

  // 以 detached 模式启动守护进程，使其完全独立
  const child = spawn(process.execPath, [DAEMON_SCRIPT, "--daemon"], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
  child.unref();

  // 等待守护进程写入 PID 和 port 文件
  const info = await waitForFiles(60000);
  if (info) {
    process.exitCode = 0;
  } else {
    process.exitCode = 1;
  }
}

main().catch(() => { process.exitCode = 1; });
