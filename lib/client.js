// ========================
// 守护进程客户端（TCP 通信）
// ========================
const net = require("net");
const fs = require("fs");
const { isDaemonAlive, startDaemon, PORT_FILE } = require("./daemon");

const CONNECT_TIMEOUT = 30000;

// 获取守护进程端口
function getDaemonPort() {
  try {
    if (fs.existsSync(PORT_FILE)) {
      return parseInt(fs.readFileSync(PORT_FILE, "utf8").trim(), 10);
    }
  } catch {}
  return null;
}

// 确保守护进程在运行
async function ensureDaemon() {
  if (isDaemonAlive()) {
    const port = getDaemonPort();
    if (port) return true;
  }
  return await startDaemon();
}

// 向守护进程发送命令
async function sendToDaemon(cmd) {
  // ensureDaemon() 已在调用方确认守护进程存活，此处直接连接
  const port = getDaemonPort();
  if (!port) throw new Error("无法获取守护进程端口");

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, "127.0.0.1");
    let stdout = "";
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        socket.destroy();
        resolve({ stdout, timeout: true });
      }
    }, CONNECT_TIMEOUT);

    socket.on("data", (chunk) => {
      stdout += chunk.toString();
      // 检查是否收到完整响应（以 \n 结尾的 JSON）
      const lines = stdout.split("\n");
      for (const line of lines) {
        if (line.trim()) {
          try {
            const result = JSON.parse(line);
            if (!resolved) {
              resolved = true;
              clearTimeout(timeout);
              socket.end();
              resolve({ ...result, raw: line });
            }
          } catch {
            // 不完整的 JSON，继续等待
          }
        }
      }
    });

    socket.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    socket.on("connect", () => {
      const cmdStr = JSON.stringify(cmd) + "\n";
      socket.write(cmdStr);
    });
  });
}

module.exports = { ensureDaemon, sendToDaemon };
