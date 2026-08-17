---
name: deepseek-ai-chat
description: 通过 Playwright + Edge 浏览器自动化调用 DeepSeek 网页版对话。支持快速模式、专家模式、识图模式、历史对话复用、守护进程。当需要调用 DeepSeek 进行复杂推理、深度分析或长文本处理时使用。
user-invocable: true
---

# DeepSeek AI Chat

通过命令行脚本与 DeepSeek AI 进行自动对话。支持连续对话、文件上传、流式输出、历史对话管理。

## 前置条件

- Node.js >= 18
- Microsoft Edge 浏览器
- 已配置 `config.json` 或环境变量（首次使用需登录）

脚本路径：`.openclaw/login/deepseek-ai.js`

## 何时使用此 Skill

- 用户要求与 DeepSeek AI 对话
- 用户要求发送消息给 DeepSeek
- 用户要求分析文件（图片、文档、代码）
- 用户要求继续之前的对话
- 用户要求导出、删除、列出历史对话
- 用户要求切换对话模式（快速/专家/识图）

## 核心工作流

### 1. 检查登录状态

脚本启动时自动检查会话。如果已登录（cookie 有效），直接进入聊天。

如果未登录，按优先级读取凭据：
1. 环境变量 `DEEPSEEK_PHONE` / `DEEPSEEK_PASSWORD`
2. `config.json` 中的 `autoLogin.phone` / `autoLogin.password`
3. 自动登录失败则弹出浏览器手动登录

### 2. 执行对话

根据用户需求选择合适的调用方式：

| 场景 | 调用方式 |
|------|---------|
| 一次性提问 | 普通模式，发消息后自动退出 |
| 多轮连续对话 | `--continue` 或守护进程 |
| 需要保持浏览器常驻 | 守护进程 `--daemon` |
| 长文本实时查看 | `--stream` 流式输出 |

### 3. 处理回复

脚本输出结构化格式：

```
=== AI_REPLIES ===
--- REPLY_1 ---
AI 回复内容
=== END ===
```

流式模式下增量输出到 stdout，末尾标记 `[N字]`。

## 命令速查

### 帮助

```bash
node .openclaw/login/deepseek-ai.js --help
```

### 普通模式

```bash
# 快速模式（默认）
node .openclaw/login/deepseek-ai.js "你好"

# 专家模式
node .openclaw/login/deepseek-ai.js --mode expert "详细分析"

# 识图模式 + 文件
node .openclaw/login/deepseek-ai.js --mode vision --file photo.png "描述图片"

# 继续最近对话
node .openclaw/login/deepseek-ai.js --continue "追问"

# 复用指定对话
node .openclaw/login/deepseek-ai.js --chat 3 "追问"
node .openclaw/login/deepseek-ai.js --chat "标题" "追问"

# 列出历史对话
node .openclaw/login/deepseek-ai.js --list

# 新建对话
node .openclaw/login/deepseek-ai.js --new

# 导出当前对话（Markdown）
node .openclaw/login/deepseek-ai.js --export

# 删除对话
node .openclaw/login/deepseek-ai.js --delete 3

# 流式输出
node .openclaw/login/deepseek-ai.js --stream "长文本问题"
```

### 守护进程模式

```bash
# 启动守护进程
node .openclaw/login/deepseek-ai.js --daemon
```

启动后输出 `READY`，通过 stdin 发送 JSON 命令：

```json
{"action":"chat","messages":["你好"],"mode":"fast"}
{"action":"chat","messages":["深度分析"],"mode":"expert"}
{"action":"chat","messages":["描述图片"],"mode":"vision","files":["photo.png"],"stream":true}
{"action":"list"}
{"action":"mode","mode":"expert"}
{"action":"new"}
{"action":"continue"}
{"action":"delete","index":3}
{"action":"export"}
{"action":"close"}
```

或直接输入纯文本（自动作为 fast 模式消息发送）。

## 对话模式

| 模式 | 参数 | 深度思考 | 联网搜索 | 文件上传 | 适用场景 |
|------|------|---------|---------|---------|---------|
| 快速模式 | `fast`（默认） | 默认开启 | 支持 | 支持 | 日常问答、需要联网搜索 |
| 专家模式 | `expert` | 默认开启 | 不支持 | 不支持 | 复杂问题、数学推导、深度分析 |
| 识图模式 | `vision` | 默认开启 | 不支持 | 支持 | 图片分析、文档解读、OCR |

> 深度思考三模式均默认开启，脚本在切换模式时自动控制。
> 联网搜索仅快速模式支持，切换到专家/识图模式时自动关闭。

## 连续对话

### 方式一：`--continue`

```bash
node .openclaw/login/deepseek-ai.js --continue "第一条消息"
node .openclaw/login/deepseek-ai.js --continue "第二条消息"  # 自动续接同一会话
```

每次调用自动找到最近一次对话并续接，上下文连续保持。无历史对话时自动创建新对话。

### 方式二：守护进程

守护进程内多次 `chat` 命令自动保持同一会话上下文：

```bash
node .openclaw/login/deepseek-ai.js --daemon
{"action":"chat","messages":["第一条"]}
{"action":"chat","messages":["第二条"]}
```

## 配置

凭据和参数通过 `config.json` 或环境变量配置，**不硬编码在源码中**。

### config.json

路径：`.openclaw/login/config.json`

```json
{
  "autoLogin": {
    "enabled": true,
    "phone": "YOUR_PHONE_OR_EMAIL",
    "password": "YOUR_PASSWORD"
  },
  "retry": {
    "maxAttempts": 3,
    "baseDelay": 2000,
    "maxDelay": 15000
  },
  "responseTimeout": 120000,
  "messageInterval": 2000,
  "idleTimeout": 3600000
}
```

### 环境变量

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_PHONE` | 登录手机号 |
| `DEEPSEEK_PASSWORD` | 登录密码 |
| `DEEPSEEK_AUTO_LOGIN` | `false` 禁用自动登录 |
| `DEEPSEEK_PROFILE_DIR` | Edge 配置目录 |
| `DEEPSEEK_RESPONSE_TIMEOUT` | 回复超时（ms） |
| `DEEPSEEK_RETRY_MAX` | 最大重试次数 |
| `DEEPSEEK_RETRY_BASE` | 基础重试延迟（ms） |

## 错误处理

脚本内置重试机制（指数退避）：

- **超时错误**：网络延迟、响应慢 → 自动重试
- **网络错误**：连接中断、DNS 解析失败 → 自动重试
- **其他错误**：参数错误、页面结构变化 → 立即抛出，不重试

最大重试次数、基础延迟、最大延迟均可通过 `config.json` 或环境变量配置。

## 重要规则

1. **不要直接编辑源码中的凭据**：凭据统一通过 `config.json` 或环境变量管理
2. **不要频繁调用**：避免触发 DeepSeek 限流
3. **守护进程超时**：1 小时无操作自动关闭，避免资源泄漏
4. **专家模式限制**：不支持文件上传
5. **会话隔离**：登录会话与日常 Edge 浏览器隔离，互不影响

## 相关文档

- 完整使用指南：`.openclaw/login/README.md`
- 配置说明：`.openclaw/login/config.json`
- 脚本源码：`.openclaw/login/deepseek-ai.js`
