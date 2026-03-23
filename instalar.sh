#!/bin/bash

echo ""
echo " ╔══════════════════════════════════════╗"
echo " ║      ContatoSync — Instalação        ║"
echo " ╚══════════════════════════════════════╝"
echo ""

# Verifica Node.js
if ! command -v node &> /dev/null; then
    echo " ❌ Node.js não encontrado!"
    echo ""
    echo " Por favor instale o Node.js em:"
    echo " https://nodejs.org  (baixe a versão LTS)"
    echo ""
    exit 1
fi

NODE_VER=$(node --version)
echo " ✅ Node.js $NODE_VER encontrado"
echo ""

# Instala dependências
echo " 📦 Instalando dependências..."
npm install
if [ $? -ne 0 ]; then
    echo " ❌ Erro na instalação das dependências"
    exit 1
fi
echo " ✅ Dependências instaladas"
echo ""

# Copia .env se não existir
if [ ! -f .env ]; then
    cp .env.example .env
    echo " ✅ Arquivo .env criado"
else
    echo " ✅ Arquivo .env já existe"
fi

# Permissão de execução para o iniciar.sh
chmod +x iniciar.sh

echo ""
echo " ══════════════════════════════════════"
echo " ✅ Instalação concluída!"
echo ""
echo " Para iniciar o ContatoSync, execute:"
echo "    ./iniciar.sh"
echo " ══════════════════════════════════════"
echo ""
