@echo off
title AI Translator launcher

rem First run only: install frontend packages if they are missing
if not exist "%~dp0frontend\node_modules" (
  echo Installing frontend packages, please wait...
  pushd "%~dp0frontend"
  call npm install
  popd
)

echo Starting backend  (http://127.0.0.1:8000) ...
start "Translator Backend" /d "%~dp0backend" cmd /k python -m uvicorn main:app --reload --port 8000

echo Starting frontend (http://localhost:5173) ...
start "Translator Frontend" /d "%~dp0frontend" cmd /k npm run dev

echo Waiting for the servers to start...
timeout /t 8 /nobreak >nul
start http://localhost:5173

echo.
echo Done. To stop the app, close the two black windows
echo named "Translator Backend" and "Translator Frontend".
timeout /t 5 >nul
