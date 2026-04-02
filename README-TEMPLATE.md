# 🚀 ContatoSync - Template para Clientes

Este é um template para criar instalações isoladas do ContatoSync para cada cliente.

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/albertonpf-jpg/contatosync)

---

## 📋 O que é o ContatoSync?

Sistema que salva **automaticamente** contatos do WhatsApp no Google Contacts ou iCloud.

**Ideal para:**
- Lojas que vendem pelo WhatsApp
- Corretores de imóveis
- Vendedores autônomos
- Empresas que recebem leads por WhatsApp

---

## ✨ Funcionalidades

- ✅ Salvamento automático de novos contatos WhatsApp
- ✅ Sincronização com Google Contacts
- ✅ Sincronização com iCloud (CardDAV)
- ✅ Sincronização de histórico de conversas
- ✅ Nomes sequenciais personalizáveis
- ✅ Painel web de gerenciamento
- ✅ Proteção anti-banimento WhatsApp
- ✅ Totalmente isolado (1 cliente = 1 servidor)

---

## 🎯 Modelo de Deploy

### Cada instalação é 100% isolada:
```
Cliente A → Railway próprio → IP único → WhatsApp próprio
Cliente B → Railway próprio → IP único → WhatsApp próprio
Cliente C → Railway próprio → IP único → WhatsApp próprio
```

**Zero risco de interferência entre clientes!**

---

## 🚀 Deploy Rápido (15 minutos)

### Passo 1: Criar repositório do template
1. Clicar em "Use this template"
2. Nome: `contatosync-[nome-cliente]`
3. Create repository

### Passo 2: Deploy no Railway
1. Clicar no botão "Deploy on Railway" acima
2. Login com GitHub
3. Conectar repositório criado
4. Configurar variáveis de ambiente:
   ```env
   PORT=3000
   CONTACT_PREFIX=Contato Zap
   CONTACT_SEQ_START=1
   BATCH_SIZE=10
   BATCH_DELAY_MS=2000
   GOOGLE_CLIENT_ID=(pegar do Google Cloud)
   GOOGLE_CLIENT_SECRET=(pegar do Google Cloud)
   GOOGLE_REDIRECT_URI=(URL Railway + /auth/google/callback)
   ```
5. Deploy

### Passo 3: Configurar Google Cloud
Ver guia completo em: [SETUP-CLIENTE.md](SETUP-CLIENTE.md)

### Passo 4: Conectar WhatsApp
1. Acessar URL do Railway
2. Escanear QR Code
3. Pronto!

---

## 📁 Documentação Completa

- **Setup passo-a-passo:** [SETUP-CLIENTE.md](SETUP-CLIENTE.md)
- **Replicação rápida:** [REPLICACAO-RAPIDA.md](REPLICACAO-RAPIDA.md)
- **README original:** [README.md](README.md)

---

## 💰 Custos

### Railway (hospedagem 24/7):
- **Hobby:** $5/mês (uso leve)
- **Pro:** $20/mês de crédito incluso (uso médio/alto)

### Google Cloud:
- **Grátis** até 10.000 requisições/dia
- Suficiente para 99% dos casos

### iCloud:
- **Grátis** (usar Apple ID existente)

**Total:** ~$5-10/mês por cliente

---

## 🔐 Segurança e Privacidade

- ✅ Cada cliente tem servidor próprio
- ✅ Dados não são compartilhados
- ✅ Sessão WhatsApp isolada
- ✅ IP único por instalação
- ✅ Zero acesso a contatos de terceiros

---

## 🆘 Suporte

**Para vendors/revendedores:**
- Email: alberto@plannedmidia.com.br
- GitHub Issues: [albertonpf-jpg/contatosync](https://github.com/albertonpf-jpg/contatosync/issues)

**Para clientes finais:**
- Contatar seu fornecedor/instalador

---

## 📦 Stack Técnica

- **Backend:** Node.js + Express
- **WhatsApp:** Baileys (API não oficial)
- **Google:** Google People API (OAuth2)
- **iCloud:** CardDAV
- **Deploy:** Railway / Docker
- **Frontend:** HTML + CSS + Vanilla JS

---

## ⚠️ Avisos Importantes

### Sobre o WhatsApp:
- Usa API não oficial (Baileys)
- Risco de bloqueio existe (baixo com uso correto)
- Não enviar spam ou mensagens em massa
- Usar limites de velocidade configurados (anti-ban)

### Recomendações:
- ✅ Usar número secundário (não o principal de vendas)
- ✅ Ter backup de contatos importantes
- ✅ Testar por 30 dias antes de depender 100%
- ✅ Não usar para envio em massa

---

## 📜 Licença

MIT License - Livre para uso comercial

---

## 🎯 Roadmap

- [ ] Suporte a múltiplos usuários por instalação
- [ ] Integração com WhatsApp Business API oficial
- [ ] Exportação de relatórios
- [ ] Webhooks para integrações
- [ ] App móvel de gerenciamento
- [ ] Dashboard de analytics

---

## 👨‍💻 Autor

**Alberto Nascimento**
- Empresa: [Planned Midia](https://plannedmidia.com.br)
- GitHub: [@albertonpf-jpg](https://github.com/albertonpf-jpg)
- Localização: Embu das Artes, SP, Brasil

---

## 🌟 Como Revender

Interessado em revender o ContatoSync?

**Modelo sugerido:**
- Setup: R$ 397 (instalação + configuração)
- Mensalidade: R$ 147/mês (manutenção + suporte)

**Você gerencia:**
- Instalação para cada cliente
- Suporte técnico
- Atualizações
- Monitoramento

**Documentação completa:** [REPLICACAO-RAPIDA.md](REPLICACAO-RAPIDA.md)

---

**Feito com ❤️ no Brasil**
