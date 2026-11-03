@echo off
cd /d "%~dp0.."
title ClassSync Helper
python helper.py
if errorlevel 1 pause
