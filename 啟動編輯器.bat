@echo off
chcp 65001 >nul
cd /d "%~dp0"
title VN Script Editor

rem 第一次執行時先安裝套件
if not exist node_modules (
  echo 第一次執行，正在安裝套件……
  call npm install
)

rem 等伺服器啟動後，用 Edge 的「應用程式模式」開啟（沒有網址列，像一般桌面程式）
start "" cmd /c "timeout /t 3 >nul & start msedge --app=http://localhost:5173"

echo 編輯器執行中。關掉這個視窗就會停止編輯器。
call npm run dev
