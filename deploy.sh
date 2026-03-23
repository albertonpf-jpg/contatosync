#!/bin/bash
# ContatoSync — Script de deploy completo

TOKEN="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"
USUARIO="albertonpf-jpg"
REPO="contatosync"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║     ContatoSync — Deploy Script      ║"
echo "╚══════════════════════════════════════╝"
echo ""

# 1. Criar repositório no GitHub
echo "1. Criando repositório no GitHub..."
RESULT=$(curl -s -X POST "https://api.github.com/user/repos" \
  -H "Authorization: token $TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"$REPO\",\"description\":\"Sincronizador automatico de contatos WhatsApp\",\"private\":false}")

URL=$(echo $RESULT | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('html_url',''))" 2>/dev/null)
MSG=$(echo $RESULT | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message',''))" 2>/dev/null)

if [ -n "$URL" ]; then
  echo "   ✅ Repositório criado: $URL"
elif echo "$MSG" | grep -q "already exists"; then
  echo "   ✅ Repositório já existe"
  URL="https://github.com/$USUARIO/$REPO"
else
  echo "   ⚠️  $MSG"
  URL="https://github.com/$USUARIO/$REPO"
fi

# 2. Push do código
echo ""
echo "2. Enviando código para o GitHub..."
git remote add origin "https://$TOKEN@github.com/$USUARIO/$REPO.git" 2>/dev/null || \
  git remote set-url origin "https://$TOKEN@github.com/$USUARIO/$REPO.git"
git branch -M main
git push -u origin main --force

if [ $? -eq 0 ]; then
  echo "   ✅ Código enviado com sucesso!"
else
  echo "   ❌ Erro no push"
  exit 1
fi

echo ""
echo "══════════════════════════════════════"
echo "✅ GitHub: $URL"
echo ""
echo "Agora faça o deploy no Railway:"
echo ""
echo "1. Acesse: https://railway.app/new"
echo "2. Clique em 'Deploy from GitHub repo'"
echo "3. Selecione: $USUARIO/$REPO"
echo "4. Clique em 'Add variables' e adicione:"
echo ""
echo "   GOOGLE_CLIENT_ID=142911777992-qtri7kr3vfmokqumdugi15u4g09kf9gg.apps.googleusercontent.com"
echo "   GOOGLE_CLIENT_SECRET=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"
echo "   GOOGLE_REDIRECT_URI=https://SEU-DOMINIO.railway.app/auth/google/callback"
echo "   PORT=3000"
echo "   CONTACT_PREFIX=Contato Zap"
echo "   CONTACT_SEQ_START=1"
echo "   BATCH_SIZE=10"
echo "   BATCH_DELAY_MS=2000"
echo "   NODE_ENV=production"
echo ""
echo "5. Clique em 'Deploy Now'"
echo "6. Após o deploy, vá em Settings → Generate Domain"
echo "7. Atualize GOOGLE_REDIRECT_URI com o domínio gerado"
echo "══════════════════════════════════════"
