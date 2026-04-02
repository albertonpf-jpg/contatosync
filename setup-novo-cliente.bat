@echo off
chcp 65001 >nul
cls

echo ========================================
echo 🚀 ContatoSync - Setup Novo Cliente
echo ========================================
echo.

REM Coletar informações
set /p CLIENTE_NOME="Nome do cliente: "
set /p CLIENTE_EMAIL="Email do cliente: "
set /p RAILWAY_PROJECT="Nome do projeto Railway (ex: contatosync-loja-xyz): "
set /p RAILWAY_URL="URL do Railway (ex: https://xxxxx.up.railway.app): "

echo.
echo 🔐 Credenciais Google Cloud:
echo.
set /p GOOGLE_ID="Google Client ID: "
set /p GOOGLE_SECRET="Google Client Secret: "

echo.
echo 📝 Configurações:
echo.
set /p PREFIX="Prefixo dos contatos (ex: Contato Zap): "
set /p SEQ_START="Número inicial (ex: 1): "

REM Criar arquivo .env
echo.
echo 📄 Criando arquivo .env.cliente...

(
echo # ─────────────────────────────────────────────────────────
echo #  ContatoSync — %CLIENTE_NOME%
echo #  Gerado em: %DATE% %TIME%
echo # ─────────────────────────────────────────────────────────
echo.
echo PORT=3000
echo CONTACT_PREFIX=%PREFIX%
echo CONTACT_SEQ_START=%SEQ_START%
echo.
echo # ── Google Contacts ───────────────────────────────────────
echo GOOGLE_CLIENT_ID=%GOOGLE_ID%
echo GOOGLE_CLIENT_SECRET=%GOOGLE_SECRET%
echo GOOGLE_REDIRECT_URI=%RAILWAY_URL%/auth/google/callback
echo.
echo # ── Anti-ban WhatsApp ─────────────────────────────────────
echo BATCH_SIZE=10
echo BATCH_DELAY_MS=2000
) > .env.cliente

echo ✅ Arquivo .env.cliente criado!
echo.
echo 📋 Próximos passos:
echo.
echo 1. Copiar conteúdo do .env.cliente para Railway:
echo    Railway → Variables → Raw Editor → Colar
echo.
echo 2. Aguardar deploy completar
echo.
echo 3. Acessar: %RAILWAY_URL%
echo.
echo 4. Conectar WhatsApp (escanear QR Code)
echo.
echo 5. Conectar Google Contacts
echo.
echo ════════════════════════════════════════
echo.
echo 📧 Cliente: %CLIENTE_NOME%
echo 🌐 URL: %RAILWAY_URL%
echo 📁 Arquivo: .env.cliente
echo.
echo ✅ Setup concluído!
echo.

REM Abrir arquivo .env.cliente no notepad
notepad .env.cliente

pause
