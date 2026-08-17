# DeepSeek AI 守护进程管理脚本
# 用法: .\daemon.ps1 [start|stop|status|restart]
#
# 重要: 守护进程需要从 PowerShell 前台启动（非后台）
#   1. 在 PowerShell 中运行: .\daemon.ps1 start
#   2. 保持 PowerShell 窗口打开（或最小化）
#   3. 在 Git Bash 中正常使用 deepseek-ai.js（自动连接守护进程）

param(
    [string]$Action = "status"
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $env:TEMP "deepseek-daemon.pid"
$PortFile = Join-Path $env:TEMP "deepseek-daemon.port"
$DaemonScript = Join-Path $ProjectDir "deepseek-ai.js"
$NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodeExe) {
    $fallback = "C:\Program Files\nodejs\node.exe"
    if (Test-Path $fallback) { $NodeExe = $fallback }
}
if (-not $NodeExe) {
    Write-Host "[ERROR] 未找到 node.exe，请安装 Node.js 或确保其在 PATH 中" -ForegroundColor Red
    exit 1
}

function Get-DaemonPid {
    if (-not (Test-Path $PidFile)) { return $null }
    try {
        $pid = [int](Get-Content $PidFile -ErrorAction SilentlyContinue)
        if ($pid -gt 0) {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc) { return $pid }
        }
    } catch {}
    return $null
}

function Get-DaemonPort {
    if (-not (Test-Path $PortFile)) { return $null }
    try {
        return [int](Get-Content $PortFile -ErrorAction SilentlyContinue)
    } catch { return $null }
}

function Start-Daemon {
    $daemonPid = Get-DaemonPid
    if ($daemonPid) {
        Write-Host "[INFO] 守护进程已在运行 (PID: $daemonPid)" -ForegroundColor Yellow
        Write-Host "[*] 如需重启，请先运行: .\daemon.ps1 stop" -ForegroundColor Yellow
        return
    }

    Write-Host "[*] 启动守护进程..." -ForegroundColor Cyan
    Write-Host "[*] 请保持此 PowerShell 窗口打开" -ForegroundColor Yellow
    Remove-Item $PidFile -ErrorAction SilentlyContinue
    Remove-Item $PortFile -ErrorAction SilentlyContinue

    # 前台启动（后台模式会导致 Edge 崩溃）
    $env:DEEPSEEK_DAEMON_MODE = "1"
    & $NodeExe $DaemonScript --daemon
}

function Stop-Daemon {
    $daemonPid = Get-DaemonPid
    if (-not $daemonPid) {
        Write-Host "[INFO] 无运行中的守护进程" -ForegroundColor Yellow
        return
    }

    Write-Host "[*] 关闭守护进程 (PID: $daemonPid)..." -ForegroundColor Cyan
    try {
        Stop-Process -Id $daemonPid -Force -ErrorAction Stop
        Remove-Item $PidFile -ErrorAction SilentlyContinue
        Remove-Item $PortFile -ErrorAction SilentlyContinue
        Write-Host "[OK] 守护进程已关闭" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] 关闭失败: $_" -ForegroundColor Red
    }
}

switch ($Action.ToLower()) {
    "start" { Start-Daemon }
    "stop" { Stop-Daemon }
    "restart" { Stop-Daemon; Start-Sleep -Seconds 1; Start-Daemon }
    "status" {
        $daemonPid = Get-DaemonPid
        $port = Get-DaemonPort
        if ($daemonPid -and $port) {
            Write-Host "[OK] 守护进程运行中 (PID: $daemonPid, Port: $port)" -ForegroundColor Green
        } else {
            Write-Host "[INFO] 守护进程未运行" -ForegroundColor Yellow
            Write-Host "[*] 启动命令: .\daemon.ps1 start" -ForegroundColor Cyan
        }
    }
    default {
        Write-Host "用法: .\daemon.ps1 [start|stop|status|restart]" -ForegroundColor Red
        Write-Host "  start     - 前台启动守护进程（保持窗口打开）"
        Write-Host "  stop      - 关闭守护进程"
        Write-Host "  status    - 查看守护进程状态"
        Write-Host "  restart   - 重启守护进程"
    }
}
