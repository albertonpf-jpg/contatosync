# ⚡ Replicação Rápida - Novo Cliente

**Objetivo:** Criar uma instalação isolada para cada cliente em 15 minutos.

---

## 🎯 Visão Geral

Cada cliente terá:
- ✅ Railway project próprio (isolado)
- ✅ GitHub repo próprio (fork/template)
- ✅ Google Cloud próprio
- ✅ WhatsApp conectado no servidor dele
- ✅ Zero interferência entre clientes

---

## 🚀 Método 1: Deploy Rápido (Recomendado)

### Pré-requisitos:
- [ ] Conta GitHub do cliente (ou sua)
- [ ] Conta Railway do cliente (ou sua)

### Passo a Passo:

#### 1️⃣ Criar Fork/Template (2 min)
```bash
Opção A - Fork (mais simples):
1. Ir no repositório: albertonpf-jpg/contatosync
2. Clicar "Fork"
3. Owner: conta do cliente (ou sua)
4. Nome: contatosync-[nome-cliente]
5. Create fork

Opção B - Template (melhor para escala):
1. Transformar repo em template (Settings → Template repository)
2. Use this template → Create new repository
3. Nome: contatosync-[nome-cliente]
```

#### 2️⃣ Deploy no Railway (3 min)
```bash
1. Login Railway: https://railway.app
2. New Project
3. Deploy from GitHub repo
4. Selecionar: contatosync-[nome-cliente]
5. Add variables (ver próximo passo)
6. Deploy
```

#### 3️⃣ Configurar Variáveis Railway (2 min)
```
Railway → Variables → Raw Editor → Colar:

PORT=3000
CONTACT_PREFIX=Contato Zap
CONTACT_SEQ_START=1
BATCH_SIZE=10
BATCH_DELAY_MS=2000
GOOGLE_CLIENT_ID=PREENCHER_DEPOIS
GOOGLE_CLIENT_SECRET=PREENCHER_DEPOIS
GOOGLE_REDIRECT_URI=https://SEU-APP.up.railway.app/auth/google/callback
```

#### 4️⃣ Gerar Domínio Railway (1 min)
```
1. Settings → Networking → Generate Domain
2. Copiar URL: https://xxxxx.up.railway.app
3. Voltar em Variables
4. Editar GOOGLE_REDIRECT_URI com a URL real
5. Salvar (redeploy automático)
```

#### 5️⃣ Configurar Google Cloud (8 min)
```
Seguir: SETUP-CLIENTE.md → Passo 2
```

#### 6️⃣ Testar (2 min)
```
1. Acessar URL Railway
2. Conectar WhatsApp (QR Code)
3. Conectar Google
4. Enviar mensagem de teste
5. Confirmar salvamento
```

---

## 🔧 Método 2: Script Automatizado

```bash
# 1. Clonar repositório
git clone https://github.com/albertonpf-jpg/contatosync.git contatosync-cliente-X
cd contatosync-cliente-X

# 2. Executar script de setup
chmod +x setup-novo-cliente.sh
./setup-novo-cliente.sh

# 3. Copiar .env.cliente para Railway
# 4. Fazer push para GitHub do cliente
git remote set-url origin https://github.com/cliente/contatosync-cliente-X.git
git push
```

---

## 📦 Método 3: Template Railway (1 clique)

**Em desenvolvimento:**

Botão "Deploy to Railway" que:
- Cria projeto Railway automaticamente
- Pede variáveis de ambiente
- Faz deploy em 1 clique

```markdown
[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/...)
```

---

## 💰 Modelo de Cobrança

### Opção A: Cliente paga Railway direto
```
Cliente paga:
├─ Railway: $5/mês (direto Railway)
└─ Você: R$ 97/mês (licença + suporte)

Você recebe: R$ 97/mês limpos
```

### Opção B: Você gerencia Railway
```
Cliente paga:
└─ Você: R$ 147/mês (tudo incluso)

Você paga:
├─ Railway: $5/mês = R$ 25
└─ Lucro: R$ 122/mês por cliente
```

### Opção C: Setup único
```
Cliente paga:
├─ Setup: R$ 497 (uma vez)
└─ Railway: $5/mês (direto Railway)

Você configura tudo, cliente gerencia depois.
```

---

## 🔐 Segurança e Isolamento

### ✅ Cada cliente tem:
- IP único (Railway dá 1 IP por project)
- Banco de dados isolado (arquivos locais)
- Sessão WhatsApp isolada
- Credenciais Google próprias
- iCloud próprio

### ✅ Você tem acesso:
- Repositório GitHub (código)
- Conta Railway (se gerenciar)
- Logs e monitoramento

### ❌ Você NÃO tem acesso:
- Contatos do cliente (ficam no servidor dele)
- Mensagens WhatsApp
- Credenciais Google/iCloud do cliente

---

## 📊 Gestão de Múltiplos Clientes

### Organização Railway:
```
Sua conta Railway:
├─ Project: contatosync-loja-abc
├─ Project: contatosync-imobiliaria-xyz
├─ Project: contatosync-vendedor-joao
└─ ...

Ou criar conta Railway por cliente (isolamento total).
```

### Organização GitHub:
```
Opção A - Forks na sua conta:
github.com/albertonpf-jpg/contatosync-cliente1
github.com/albertonpf-jpg/contatosync-cliente2
...

Opção B - Template (melhor):
1. Marcar repo como template
2. Cada cliente = novo repo do template
3. Você tem acesso como colaborador
```

### Planilha de Controle:
```
Cliente | Railway URL | GitHub Repo | Status | Mensalidade
--------|-------------|-------------|--------|------------
Loja ABC | https://... | repo-link | Ativo | R$ 147
Imob XYZ | https://... | repo-link | Ativo | R$ 97
...
```

---

## 🔄 Atualizações Futuras

### Quando você atualizar o código:

#### Método 1 - Manual:
```bash
# No repo de cada cliente
git remote add upstream https://github.com/albertonpf-jpg/contatosync.git
git fetch upstream
git merge upstream/main
git push

# Railway faz redeploy automático
```

#### Método 2 - GitHub Actions (automático):
```yaml
# .github/workflows/sync-upstream.yml
# Sincroniza com repo principal 1x por semana
```

---

## ⚠️ Checklist Antes de Entregar

- [ ] Railway rodando sem erros (verificar logs)
- [ ] WhatsApp conectado e recebendo mensagens
- [ ] Google Contacts conectado
- [ ] Teste de salvamento manual funcionando
- [ ] Teste de auto-save funcionando
- [ ] Sincronização de histórico testada
- [ ] Cliente consegue acessar URL
- [ ] Pagamento Railway configurado
- [ ] Documentação entregue ao cliente
- [ ] Contato de suporte fornecido

---

## 📞 Entregar ao Cliente

**Email template:**
```
Olá [Cliente],

Seu ContatoSync está instalado e funcionando! 🎉

📱 Acesse aqui: https://xxxxx.up.railway.app

✅ O que já está configurado:
- WhatsApp conectado
- Google Contacts integrado
- Auto-save ativado

📚 Guia de uso: [link para documentação]

💳 Pagamento:
- Mensalidade: R$ 147/mês
- PIX/Boleto: [dados]

🆘 Suporte:
- WhatsApp: (11) xxxxx-xxxx
- Email: suporte@...

Qualquer dúvida, estou à disposição!

Alberto Nascimento
Planned Midia
```

---

## 🎯 Resumo: 15 Minutos por Cliente

```
✅ 2 min - Fork GitHub
✅ 3 min - Deploy Railway
✅ 2 min - Configurar variáveis
✅ 1 min - Gerar domínio
✅ 5 min - Google Cloud (se rápido)
✅ 2 min - Testar
───────────────
   15 min TOTAL
```

**Com prática, você faz em 10 minutos! 🚀**
