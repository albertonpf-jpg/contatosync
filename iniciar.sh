#!/bin/bash

echo ""
echo " ╔══════════════════════════════════════╗"
echo " ║        ContatoSync — Iniciando       ║"
echo " ╚══════════════════════════════════════╝"
echo ""

# Verifica dependências
if [ ! -d node_modules ]; then
    echo " ⚠️  Dependências não instaladas. Executando instalação..."
    bash instalar.sh
fi

# Verifica .env
if [ ! -f .env ]; then
    cp .env.example .env
    echo " ⚠️  Configure suas credenciais do Google em:"
    echo "    $(pwd)/.env"
    echo ""
fi

echo " 🚀 Iniciando servidor..."
echo " 🌐 Acesse: http://localhost:3000"
echo ""
echo " (Pressione Ctrl+C para parar)"
echo ""

# Abre o navegador após 2 segundos (Mac e Linux)
(sleep 2 && (open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null)) &

# Inicia o servidor
node src/index.js
