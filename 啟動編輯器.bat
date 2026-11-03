@echo off
chcp 65001 >nul
cd /d "%~dp0"
title VN Script Editor

rem 第一次使用時先安裝套件（需要網路，約幾分鐘）
if not exist node_modules (
    echo 第一次啟動，正在安裝套件…
    call npm install
)

rem 啟動 Vite 開發伺服器與 Tauri 視窗
rem 第一次啟動要編譯 Rust 主程式（src-tauri），會比較久（幾分鐘）；之後只要幾秒
rem 關掉編輯器視窗後，這個命令列視窗會跟著結束
echo 正在啟動編輯器，請稍候…
call npm run dev
