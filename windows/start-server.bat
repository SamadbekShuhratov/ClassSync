@echo off
cd /d "%~dp0.."
title ClassSync server
python run.py --open
if errorlevel 1 pause
