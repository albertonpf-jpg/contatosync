#!/bin/bash

# ========================================
# ContatoSync - Setup Automatizado
# ========================================

echo "🚀 ContatoSync - Setup Novo Cliente"
echo "===================================="
echo ""

# Função para pedir input
pedir_input() {
    local prompt="$1"
    local var_name="$2"
    read -p "$prompt: " input
    eval "$var_name='$input'"
}

# Coletar informações
echo "📋 Informações do Cliente:"
echo ""
pedir_input "Nome do cliente" CLIENTE_NOME
pedir_input "Email do cliente" CLIENTE_EMAIL
pedir_input "Nome do projeto Railway (ex: contatosync-loja-xyz)" RAILWAY_PROJECT
pedir_input "URL do Railway (ex: https://xxxxx.up.railway.app)" RAILWAY_URL

echo ""
echo "🔐 Credenciais Google Cloud:"
echo ""
pedir_input "Google Client ID" GOOGLE_ID
pedir_input "Google Client Secret" GOOGLE_SECRET

echo ""
echo "📝 Configurações:"
echo ""
pedir_input "Prefixo dos contatos (ex: Contato Zap)" PREFIX
pedir_input "Número inicial (ex: 1)" SEQ_START

# Criar arquivo .env
echo ""
echo "📄 Criando arquivo .env..."

cat > .env.cliente << EOF
# ─────────────────────────────────────────────────────────
#  ContatoSync — ${CLIENTE_NOME}
#  Gerado em: $(date)
# ─────────────────────────────────────────────────────────

PORT=3000
CONTACT_PREFIX=${PREFIX}
CONTACT_SEQ_START=${SEQ_START}

# ── Google Contacts ───────────────────────────────────────
GOOGLE_CLIENT_ID=${GOOGLE_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_SECRET}
GOOGLE_REDIRECT_URI=${RAILWAY_URL}/auth/google/callback

# ── Anti-ban WhatsApp ─────────────────────────────────────
BATCH_SIZE=10
BATCH_DELAY_MS=2000
EOF

echo "✅ Arquivo .env.cliente criado!"
echo ""
echo "📋 Próximos passos:"
echo ""
echo "1. Copiar conteúdo do .env.cliente para Railway:"
echo "   Railway → Variables → Raw Editor → Colar"
echo ""
echo "2. Aguardar deploy completar"
echo ""
echo "3. Acessar: ${RAILWAY_URL}"
echo ""
echo "4. Conectar WhatsApp (escanear QR Code)"
echo ""
echo "5. Conectar Google Contacts"
echo ""
echo "════════════════════════════════════════"
echo ""
echo "📧 Cliente: ${CLIENTE_NOME}"
echo "🌐 URL: ${RAILWAY_URL}"
echo "📁 Arquivo: .env.cliente"
echo ""
echo "✅ Setup concluído!"
