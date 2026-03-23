@echo off
chcp 65001 >nul
echo.
echo  ╔══════════════════════════════════════╗
echo  ║        ContatoSync — Iniciando       ║
echo  ╚══════════════════════════════════════╝
echo.

:: Verifica se dependências estão instaladas
if not exist node_modules (
    echo  ⚠️  Dependências não instaladas. Executando instalação...
    call instalar.bat
)

:: Verifica .env
if not exist .env (
    copy .env.example .env >nul
    echo  ✅ Arquivo .env criado
    echo.
    echo  ⚠️  Configure suas credenciais do Google em:
    echo     %cd%\.env
    echo.
)

echo  🚀 Iniciando servidor...
echo  🌐 Acesse: http://localhost:3000
echo.
echo  (Pressione Ctrl+C para parar)
echo.

:: Abre o navegador após 2 segundos
start /min "" cmd /c "timeout /t 2 >nul && start http://localhost:3000"

:: Inicia o servidor
node src/index.js
