@echo off
chcp 65001 >nul
cd /d "%~dp0"
title VN Script Editor

rem 第一次使用時先安裝套件（含 Electron，需要網路，約幾分鐘）
if not exist node_modules (
    echo 第一次啟動，正在安裝套件…
    call npm install
)

rem 啟動 Vite 開發伺服器與 Electron 視窗（Electron 會自己開視窗，不再用瀏覽器）
rem 關掉編輯器視窗後，這個命令列視窗會跟著結束
echo 正在啟動編輯器，請稍候…
call npm run dev
