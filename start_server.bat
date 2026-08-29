@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  ============================================
echo   医考题库 - 启动本地服务器
echo  ============================================
echo.
echo  正在获取本机 IP 地址...
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /i "IPv4"') do (
    set "IP=%%i"
    goto :found
)
:found
set "IP=%IP: =%"
echo.
echo   本地预览地址：
echo.
echo        http://%IP%:8080
echo.
echo   该 HTTP 地址仅用于局域网预览。
echo   iPhone 正式安装及离线使用请打开已发布的 HTTPS 地址，
echo   再点「分享」->「添加到主屏幕」。
echo.
echo   请保持本窗口开启（不要关闭），
echo   电脑和手机需连接同一个 WiFi。
echo  ============================================
echo.
python -m http.server 8080
