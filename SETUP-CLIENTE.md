# 🚀 Setup Rápido - Novo Cliente

**Tempo estimado:** 15-20 minutos

---

## 📋 Checklist Pré-Setup

Antes de começar, tenha em mãos:

- [ ] Email do cliente
- [ ] Telefone que será usado no WhatsApp
- [ ] Conta Railway do cliente (ou criar nova)
- [ ] Conta Google Cloud do cliente (ou criar nova)

---

## 🔧 Passo 1: Criar Projeto Railway (5 min)

### 1.1 - Acessar Railway
- Ir em: https://railway.app
- Login com GitHub do CLIENTE (ou criar conta)

### 1.2 - Deploy via Template
```
Opção A - Com botão (mais fácil):
1. Clicar no botão "Deploy on Railway" do README
2. Conectar GitHub
3. Aguardar deploy automático

Opção B - Manual:
1. New Project → Deploy from GitHub repo
2. Conectar este repositório (fork do cliente)
3. Add variables (copiar do .env.example)
4. Deploy
```

### 1.3 - Configurar Variáveis
```env
PORT=3000
CONTACT_PREFIX=Contato Zap
CONTACT_SEQ_START=1
GOOGLE_CLIENT_ID=(preencher depois)
GOOGLE_CLIENT_SECRET=(preencher depois)
GOOGLE_REDIRECT_URI=https://SEU-APP.up.railway.app/auth/google/callback
```

### 1.4 - Gerar Domínio
- Settings → Generate Domain
- Anotar URL: `https://xxxxx.up.railway.app`
- Atualizar `GOOGLE_REDIRECT_URI` com essa URL

---

## 🔐 Passo 2: Configurar Google Cloud (8 min)

### 2.1 - Criar Projeto
1. Ir em: https://console.cloud.google.com
2. Novo Projeto → Nome: "ContatoSync - [Nome Cliente]"
3. Selecionar o projeto criado

### 2.2 - Ativar People API
1. Menu → APIs e Serviços → Biblioteca
2. Buscar: "People API"
3. Clicar em "Ativar"

### 2.3 - Criar Credenciais OAuth
1. APIs e Serviços → Credenciais
2. Criar Credenciais → ID do cliente OAuth 2.0
3. Tipo: Aplicativo da Web
4. Nome: "ContatoSync"
5. **URIs de redirecionamento autorizados:**
   ```
   https://SEU-APP.up.railway.app/auth/google/callback
   ```
6. Criar
7. **Copiar Client ID e Client Secret**

### 2.4 - Configurar Tela de Consentimento
1. Tela de consentimento OAuth
2. Tipo: Externo
3. Nome do app: ContatoSync
4. Email de suporte: (email do cliente)
5. Domínio autorizado: (deixar vazio)
6. Escopos: (deixar padrão)
7. Salvar

### 2.5 - Adicionar usuário de teste
1. Tela de consentimento → Usuários de teste
2. Adicionar: email do cliente (Gmail que vai conectar)
3. Salvar

### 2.6 - Atualizar Railway
1. Voltar no Railway
2. Variables → Edit
3. Colar `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`
4. Salvar (vai reiniciar automaticamente)

---

## 📱 Passo 3: Conectar WhatsApp (2 min)

1. Acessar: `https://SEU-APP.up.railway.app`
2. Clicar em "Conectar WhatsApp"
3. Escanear QR Code com WhatsApp do cliente
4. Aguardar confirmação

---

## ✅ Passo 4: Conectar Google Contacts (1 min)

1. No app, clicar "Conectar Google"
2. Fazer login com Gmail do cliente
3. Permitir acesso aos contatos
4. Confirmar conexão

---

## 🍎 (Opcional) Conectar iCloud

Se cliente usar iPhone:

1. Acessar: https://appleid.apple.com
2. Login com Apple ID do cliente
3. Segurança → Senhas para apps → Gerar senha
4. Copiar senha (formato: xxxx-xxxx-xxxx-xxxx)
5. No ContatoSync:
   - Clicar "Conectar iCloud"
   - Email: Apple ID do cliente
   - Senha: App-Specific Password gerada
   - Conectar

---

## 🧪 Passo 5: Testar (3 min)

### Teste 1: Receber mensagem nova
1. De outro WhatsApp, enviar mensagem para o número conectado
2. Verificar se aparece em "Novos Contatos" no painel
3. Clicar "Salvar" e verificar no Google Contacts

### Teste 2: Auto-save
1. Ativar "Auto-Save" no painel
2. Enviar outra mensagem de teste
3. Verificar se salvou automaticamente

### Teste 3: Sincronização de histórico
1. Clicar "Sincronizar Histórico"
2. Aguardar processamento
3. Verificar contatos salvos

---

## 💰 Configurar Pagamento (Railway)

### Cliente paga Railway direto:
1. Railway → Settings → Billing
2. Adicionar cartão de crédito
3. Plano Hobby ($5/mês) ou Pro ($20/mês)

**Ou você gerencia:**
- Cliente paga você R$ 147/mês
- Você adiciona Railway dele na sua conta
- Você paga Railway e gerencia

---

## 🔄 Manutenção Futura

### Atualizações:
```bash
# No repositório do cliente
git pull origin main
git push

# Railway faz deploy automático
```

### Logs/Debug:
- Railway → Deployments → View Logs
- Ou acessar: https://SEU-APP.up.railway.app/debug

### Backup:
- Railway → Settings → Backups (ativar)

---

## 📞 Entregar ao Cliente

Enviar:
- ✅ URL do app: `https://xxxxx.up.railway.app`
- ✅ Login Railway (se você gerenciar)
- ✅ Documentação de uso
- ✅ Contato de suporte

---

## ⚠️ Troubleshooting

**WhatsApp desconecta:**
- Verificar se celular está com internet
- Reescanear QR Code

**Google não conecta:**
- Verificar se email está em "Usuários de teste"
- Verificar REDIRECT_URI correto

**Railway não inicia:**
- Verificar logs
- Conferir variáveis de ambiente

---

## 📊 Monitoramento

**Acessar periodicamente:**
- Railway logs (erros)
- Estatísticas no painel do app
- Confirmar com cliente se está funcionando
