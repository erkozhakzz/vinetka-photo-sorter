@echo off
cd /d "%~dp0"
if exist "%LOCALAPPDATA%\Programs\VINETKA Photo Sorter\VINETKA Photo Sorter.exe" (
    start "" "%LOCALAPPDATA%\Programs\VINETKA Photo Sorter\VINETKA Photo Sorter.exe"
) else (
    npm start
)
