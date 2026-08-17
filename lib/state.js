// ========================
// 配置 + 共享状态
// ========================
const path = require("path");
const fs = require("fs");

// 加载 config.json（环境变量优先级最高）
const CONFIG_PATH = path.join(__dirname, "..", "config.json");
let fileConfig = {};
try { fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); } catch (e) {}

const CONFIG = {
  autoLogin: {
    enabled: process.env.DEEPSEEK_AUTO_LOGIN !== "false" && (fileConfig.autoLogin?.enabled ?? true),
    phone: process.env.DEEPSEEK_PHONE || fileConfig.autoLogin?.phone || "",
    password: process.env.DEEPSEEK_PASSWORD || fileConfig.autoLogin?.password || "",
  },
  retry: fileConfig.retry || { maxAttempts: 3, baseDelay: 2000, maxDelay: 15000 },
  responseTimeout: parseInt(process.env.DEEPSEEK_RESPONSE_TIMEOUT || fileConfig.responseTimeout || "120000", 10),
  messageInterval: parseInt(process.env.DEEPSEEK_MSG_INTERVAL || fileConfig.messageInterval || "2000", 10),
  idleTimeout: parseInt(process.env.DEEPSEEK_IDLE_TIMEOUT || fileConfig.idleTimeout || "3600000", 10),
};

// 共享状态（各模块通过同一对象引用读写）
const state = {
  page: null,
  context: null,
  browserStarted: false,
  initPromise: null,
  currentMode: "fast",
};

module.exports = { CONFIG, state };
