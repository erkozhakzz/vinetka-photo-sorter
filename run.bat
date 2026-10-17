@echo off
chcp 65001 >nul
title VINETKA Photo Sorter
cd /d "%~dp0"
echo ===================================================
echo   VINETKA Photo Sorter v2.2.7
echo   Студия VINETKA.KZ — Сортировка фотографий
echo ===================================================
echo.
npm start
