@echo off
cd /d "%~dp0"
chcp 65001 >nul
title VINETKA Photo Sorter - System Verification

echo ===================================================================
echo   VINETKA PHOTO SORTER - SYSTEM VERIFICATION
echo ===================================================================
echo.

where node >nul 2>nul
if errorlevel 1 goto :no_node

node test.cjs
if errorlevel 1 goto :test_error

echo.
echo ===================================================================
echo   [SUCCESS] ALL CHECKS PASSED SUCCESSFULLY!
echo ===================================================================
goto :finish

:no_node
echo [ERROR] Node.js is not found in PATH!
goto :finish

:test_error
echo.
echo ===================================================================
echo   [ERROR] ONE OR MORE TESTS FAILED!
echo ===================================================================

:finish
echo.
pause
