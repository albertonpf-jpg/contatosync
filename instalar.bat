@echo off
chcp 65001 >nul
echo.
echo  ╔══════════════════════════════════════╗
echo  ║      ContatoSync — Instalação        ║
echo  ╚══════════════════════════════════════╝
echo.

:: Verifica Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo  ❌ Node.js não encontrado!
    echo.
    echo  Por favor instale o Node.js em:
    echo  https://nodejs.org  (baixe a versão LTS)
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VER=%%i
echo  ✅ Node.js %NODE_VER% encontrado
echo.

:: Instala dependências
echo  📦 Instalando dependências...
call npm install
if errorlevel 1 (
    echo  ❌ Erro na instalação das dependências
    pause
    exit /b 1
)
echo  ✅ Dependências instaladas
echo.

:: Copia .env se não existir
if not exist .env (
    copy .env.example .env >nul
    echo  ✅ Arquivo .env criado
) else (
    echo  ✅ Arquivo .env já existe
)

echo.
echo  ══════════════════════════════════════
echo  ✅ Instalação concluída!
echo.
echo  Para iniciar o ContatoSync, execute:
echo     iniciar.bat
echo  ══════════════════════════════════════
echo.
pause
