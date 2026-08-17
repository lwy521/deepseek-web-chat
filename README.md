# DeepSeek AI 自动对话工具

基于 Playwright + Edge 实现的 DeepSeek 全自动对话脚本，支持多模式、文件上传、历史对话管理、连续对话、守护进程持久运行。

## 文件说明

| 文件 | 说明 |
|------|------|
| `deepseek-ai.js` | 主脚本 |
| `config.json` | 配置（凭据、重试、超时等） |
| `daemon.ps1` | PowerShell 守护进程管理脚本 |
| `lib/` | 模块源码（browser, chat, daemon, client, history, state, utils） |

## 环境要求

- Node.js >= 18
- Microsoft Edge 浏览器
- Playwright（依赖 playwright-core）

## 快速开始

### 1. 确保 Node.js 在 PATH 中

```powershell
node --version
```

如果未安装，从 [nodejs.org](https://nodejs.org/) 下载安装。

### 2. 配置

编辑 `config.json` 填入账号密码（首次需要），或通过环境变量覆盖：

```bash
# 环境变量方式
set DEEPSEEK_PHONE=YOUR_PHONE_OR_EMAIL
set DEEPSEEK_PASSWORD=YOUR_PASSWORD

# 或直接编辑 config.json
{
  "autoLogin": {
    "enabled": true,
    "phone": "YOUR_PHONE_OR_EMAIL",
    "password": "YOUR_PASSWORD"
  }
}
```

**优先级：环境变量 > config.json > 默认值**

### 2. 发送消息

```bash
# PowerShell 或 CMD
node deepseek-ai.js "你好，介绍一下你自己"

# 专家模式
node deepseek-ai.js --mode expert "详细分析量子计算的原理"

# 识图模式（上传图片/文件）
node deepseek-ai.js --mode vision --file photo.png "描述这张图片"
node deepseek-ai.js --mode vision -f report.pdf "总结这份报告"
```

## 运行模式

### 普通模式（默认）

每次执行自动登录 → 发消息 → 收回复 → 关闭浏览器。适合一次性调用。

```bash
node deepseek-ai.js "你好"
```

### 守护进程模式（推荐）

浏览器持久运行，登录后保持开启，后续命令自动复用。1 小时无操作自动关闭。

```bash
# 首次自动启动守护进程
node deepseek-ai.js "你好"

# 后续直接复用
node deepseek-ai.js --list
node deepseek-ai.js --new
```

守护进程在后台独立运行，关闭终端后继续存活，需手动 `node deepseek-ai.js --close` 关闭。

## 命令参数

### 全局参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--mode <模式>` | 对话模式 | `--mode expert` |
| `--file <路径>` | 上传文件 | `--file photo.png` |
| `--chat <目标>` | 复用历史对话（序号/标题/sessionId） | `--chat 3` 或 `--chat "标题"` |
| `--list` | 列出所有历史对话 | `--list` |
| `--new` | 新建对话 | `--new` |
| `--delete <序号>` | 删除历史对话 | `--delete 3` |
| `--export` | 导出当前对话为 Markdown | `--export` |
| `--continue` | 继续最近一次对话（保持上下文） | `--continue "追问"` |
| `--stream` | 流式输出（DOM 轮询增量显示） | `--stream` |
| `--daemon` | 启动守护进程 | `--daemon` |
| `--close` | 关闭浏览器 | `--close` |
| `--help` / `-h` | 显示帮助信息 | `--help` |

### 消息传递

直接传递的字符串参数会被当作消息内容发送：

```bash
node deepseek-ai.js "你好"
node deepseek-ai.js "问题1" "问题2" "问题3"
```

使用 `--` 可传递包含连字符的消息：

```bash
node deepseek-ai.js -- "hello --mode test"
```

## 对话模式

| 模式 | 参数值 | 说明 | 深度思考 | 联网搜索 | 文件上传 |
|------|--------|------|---------|---------|---------|
| 快速模式 | `fast`（默认） | 默认模式 | 默认开启 | 支持 | 支持 |
| 专家模式 | `expert` | 深度推理分析 | 默认开启 | 不支持 | 不支持 |
| 识图模式 | `vision` | 图片/文档理解 | 默认开启 | 不支持 | 支持 |

> **深度思考**：三模式均默认开启，脚本自动控制。
> **联网搜索**：仅快速模式支持，切换到专家/识图模式时自动关闭。

## 历史对话管理

### 列出所有历史对话

```bash
node deepseek-ai.js --list
```

### 继续最近对话（连续对话）

```bash
# 每次 --continue 自动续接最近一次对话，保持上下文
node deepseek-ai.js --continue "第一条消息"
node deepseek-ai.js --continue "第二条消息"
```

### 复用指定对话

```bash
# 按序号
node deepseek-ai.js --chat 3 "继续之前的话题"

# 按标题（模糊匹配）
node deepseek-ai.js --chat "DeepSeek自我介绍" "总结一下"

# 直接使用 sessionId
node deepseek-ai.js --chat <sessionId> "追问"
```

### 组合使用

```bash
# 在历史对话中用专家模式追问
node deepseek-ai.js --chat 5 --mode expert "详细解释第三点"

# 新建对话后发送消息
node deepseek-ai.js --new "新话题"
```

### 删除对话

```bash
node deepseek-ai.js --delete 3
```

### 导出对话

```bash
node deepseek-ai.js --export
```

输出 Markdown 格式，包含用户消息、AI 回复、推理过程（专家模式）。

## 流式输出

```bash
node deepseek-ai.js --stream "用一句话介绍AI"
```

流式模式下，AI 回复内容在生成过程中逐增量输出到终端，适合长文本实时查看。

## 连续对话

### 方式一：`--continue`（非守护进程）

```bash
node deepseek-ai.js --continue "第一条消息"
node deepseek-ai.js --continue "第二条消息"
```

每次调用自动找到最近一次对话并续接，上下文连续保持。

### 方式二：守护进程（推荐）

```bash
# 启动守护进程
node deepseek-ai.js --daemon
```

逐条发送消息，同一会话内上下文自动保持：

```json
{"action":"chat","messages":["第一条"]}
{"action":"chat","messages":["第二条"]}
```

### 方式三：单次多消息

```bash
node deepseek-ai.js "msg1" "msg2" "msg3"
```

## 守护进程命令

启动后通过 stdin 发送命令：

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

或直接输入纯文本（自动作为 fast 模式消息发送）：

```
你好
帮我分析一下这段代码
```

## 完整示例

```bash
# 日常问答
node deepseek-ai.js "用中文解释什么是量子纠缠"

# 深度分析
node deepseek-ai.js --mode expert "分析微服务架构的优缺点"

# 图片识别
node deepseek-ai.js --mode vision --file diagram.png "解释这个架构图"

# 连续对话
node deepseek-ai.js --continue "我的名字是Alice"
node deepseek-ai.js --continue "我叫什么名字？"

# 流式输出
node deepseek-ai.js --stream "写一篇500字短文"
```

## 配置参数

通过 `config.json` 或环境变量配置：

| 参数 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| `autoLogin.enabled` | `DEEPSEEK_AUTO_LOGIN` | `true` | 是否启用自动登录 |
| `autoLogin.phone` | `DEEPSEEK_PHONE` | - | 登录手机号 |
| `autoLogin.password` | `DEEPSEEK_PASSWORD` | - | 登录密码 |
| `retry.maxDelay` | `DEEPSEEK_RETRY_MAX_DELAY` | `15000` | 最大重试延迟（ms） |
| `responseTimeout` | `DEEPSEEK_RESPONSE_TIMEOUT` | `120000` | 等待 AI 回复超时（ms） |
| `messageInterval` | `DEEPSEEK_MSG_INTERVAL` | `2000` | 多条消息间隔（ms） |
| `idleTimeout` | `DEEPSEEK_IDLE_TIMEOUT` | `3600000` | 守护进程无操作超时（ms） |
| `retry.maxAttempts` | `DEEPSEEK_RETRY_MAX` | `3` | 最大重试次数 |
| `retry.baseDelay` | `DEEPSEEK_RETRY_BASE` | `2000` | 基础重试延迟（ms） |
| `retry.maxDelay` | `DEEPSEEK_RETRY_MAX_DELAY` | `15000` | 最大重试延迟（ms） |

### 配置示例

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

## 自动登录流程

```
打开 chat.deepseek.com
       │
       ├─ 已有有效会话 → 直接进入聊天
       │
       └─ 会话过期/首次登录
           │
           ├─ 自动登录（headless）
           │   ├─ 切换到密码登录
           │   ├─ 填写手机号
           │   ├─ 填写密码
           │   ├─ 点击登录
           │   └─ 检测登录成功
           │
           └─ 自动登录失败
               └─ 弹出 Edge 浏览器 → 等待手动登录 → 保存会话
```

## 会话存储

登录会话通过 Playwright `storageState` 持久化到 `%TEMP%/deepseek-browser-state.json`：

- 跨浏览器实例自动恢复登录态，无需每次重新登录
- 与日常 Edge 浏览器隔离，不冲突
- 删除该文件可清除登录状态

## 输出格式

```
[*] 页面: https://chat.deepseek.com/
[*] 模式: 快速模式

[1/1] 发送: 你好
  回复: AI 回复内容

=== AI_REPLIES ===
--- REPLY_1 ---
AI 回复内容
=== END ===
```

## 故障排查

### 自动登录失败

**现象**：自动登录后仍停留在登录页

**解决**：
1. 检查 `config.json` 或环境变量中的手机号和密码
2. 删除旧会话重新登录：`del %TEMP%\deepseek-browser-state.json`
3. 使用手动登录模式（脚本自动弹出 Edge 窗口）

### 会话过期

**现象**：提示需要重新登录

**解决**：
```bash
del %TEMP%\deepseek-browser-state.json
node deepseek-ai.js --list
```

### 文件上传失败

**解决**：
1. 确认文件路径正确
2. 确认使用 `--mode vision` 或默认快速模式（专家模式不支持上传）
3. 检查文件大小（建议 < 10MB）

### 守护进程无响应

**解决**：
1. 检查守护进程是否还在运行
2. 确认输入格式正确（JSON 或纯文本）
3. 查看是否有网络错误

## 安全说明

- 凭据存储在 `config.json` 或环境变量中，不硬编码在源码
- 登录会话存储在本地 `%TEMP%/deepseek-browser-state.json`，不会上传到任何服务器
- 自动登录仅在会话过期时触发，不会频繁调用
- 支持通过环境变量注入凭据（CI/CD 安全实践）

## 架构

```
┌─────────────────────────────────────────────┐
│              AI 调用方                        │
│  (Agent / 脚本 / 命令行)                      │
└──────────────┬──────────────────────────────┘
               │ stdin/stdout (JSON 或文本)
               ▼
┌─────────────────────────────────────────────┐
│           deepseek-ai.js                      │
│  ┌─────────────┐    ┌──────────────────┐   │
│  │  普通模式     │    │   守护进程模式     │   │
│  │ 登录→发消息→关│    │ 登录→持久运行→超时关│   │
│  └─────────────┘    └──────────────────┘   │
│         │                    │                │
│         └─────────┬──────────┘                │
│                   ▼                            │
│  ┌──────────────────────────────────────┐    │
│  │          Playwright 控制层             │    │
│  │  • 浏览器管理  • 自动登录              │    │
│  │  • DOM 操作   • 模式切换              │    │
│  │  • 文件上传   • 历史管理              │    │
│  │  • 会话持久化（storageState JSON）     │    │
│  └──────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│         Microsoft Edge (headless)             │
│  ┌──────────────────────────────────────┐    │
│  │         chat.deepseek.com              │    │
│  └──────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```
