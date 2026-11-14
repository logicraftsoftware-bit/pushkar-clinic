@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if errorlevel 1 exit /b 1

rem Use the local Node installation when the editor has an older PATH.
for /d %%N in ("%~dp0..\.tools\node-*-win-x64") do if exist "%%~fN\npm.cmd" set "JIBON_NODE_DIR=%%~fN"
if defined JIBON_NODE_DIR set "PATH=%JIBON_NODE_DIR%;%PATH%"
where node.exe >nul 2>&1
if errorlevel 1 goto missing_node
where npm.cmd >nul 2>&1
if errorlevel 1 goto missing_node

rem Read saved user settings without changing PowerShell execution policy.
if not defined JAVA_HOME for /f "tokens=2,*" %%A in ('reg query "HKCU\Environment" /v JAVA_HOME 2^>nul') do if /i "%%A"=="REG_SZ" set "JAVA_HOME=%%B"
if not defined ANDROID_HOME for /f "tokens=2,*" %%A in ('reg query "HKCU\Environment" /v ANDROID_HOME 2^>nul') do if /i "%%A"=="REG_SZ" set "ANDROID_HOME=%%B"
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if defined JAVA_HOME set "PATH=%JAVA_HOME%\bin;%PATH%"
set "PATH=%ANDROID_HOME%\platform-tools;%PATH%"

if /i "%~1"=="check" goto check
if /i "%~1"=="start" goto metro
if "%~1"=="" goto android
if /i "%~1"=="android" goto android
echo Usage: .\dev.cmd start ^| android ^| check
exit /b 1

:check
echo Node:
node.exe --version
if errorlevel 1 exit /b 1
echo npm:
call npm.cmd --version
if errorlevel 1 exit /b 1
if not exist "%JAVA_HOME%\bin\java.exe" goto missing_java
echo Java:
java.exe -version
if errorlevel 1 exit /b 1
if not exist "%ANDROID_HOME%\platform-tools\adb.exe" goto missing_sdk
echo Connected Android devices:
adb.exe devices
exit /b %errorlevel%

:metro
node.exe -e "fetch('http://127.0.0.1:8081/status').then(async r=>process.exit((await r.text()).includes('packager-status:running')?0:1)).catch(()=>process.exit(1))" >nul 2>&1
if not errorlevel 1 (
  echo Metro is already running on port 8081. Keep that server running.
  exit /b 0
)
call npm.cmd start -- --port 8081 --max-workers 2
exit /b %errorlevel%

:android
if not exist "%JAVA_HOME%\bin\java.exe" goto missing_java
if not exist "%ANDROID_HOME%\platform-tools\adb.exe" goto missing_sdk
node.exe -e "fetch('http://127.0.0.1:8081/status').then(async r=>process.exit((await r.text()).includes('packager-status:running')?0:1)).catch(()=>process.exit(1))" >nul 2>&1
if errorlevel 1 (
  echo Start Metro in another terminal first: .\dev.cmd start
  exit /b 1
)
call npm.cmd run android -- --no-packager --port 8081 --active-arch-only
exit /b %errorlevel%

:missing_node
echo Node.js and npm were not found. Install Node.js or restore the local .tools Node folder.
exit /b 1

:missing_java
echo JAVA_HOME does not point to an installed JDK. Configure Java before running Android.
exit /b 1

:missing_sdk
echo Android Platform Tools were not found under ANDROID_HOME.
exit /b 1
