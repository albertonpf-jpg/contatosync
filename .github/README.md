# GitHub Actions - ContatoSync

Automações configuradas para facilitar deploy e manutenção.

---

## 📋 Workflows Disponíveis

### 1. **Sync com Template Principal** (`sync-upstream.yml`)

Sincroniza automaticamente atualizações do repositório template principal.

**Quando roda:**
- Toda segunda-feira às 9h (automático)
- Manualmente via botão "Run workflow"

**O que faz:**
- Busca atualizações do repo `albertonpf-jpg/contatosync`
- Faz merge automático se não houver conflitos
- Push para o repo do cliente

**Uso manual:**
1. Ir em Actions → Sync com Template Principal
2. Clicar "Run workflow"
3. Aguardar conclusão

---

### 2. **Deploy Automático Railway** (`railway-deploy.yml`)

Deploy automático no Railway quando há alterações no código.

**Quando roda:**
- A cada push na branch `main`
- Manualmente via botão "Run workflow"

**O que faz:**
- Verifica sintaxe do código
- Faz deploy no Railway
- Testa health check

**Configuração necessária:**

#### Secrets (GitHub → Settings → Secrets):
```
RAILWAY_TOKEN = seu_token_railway
```
Obter em: https://railway.app/account/tokens

#### Variables (GitHub → Settings → Variables):
```
RAILWAY_URL = https://xxxxx.up.railway.app
RAILWAY_SERVICE_ID = seu_service_id (opcional)
```

---

### 3. **Testes Automatizados** (`tests.yml`)

Executa testes básicos antes de deploy.

**Quando roda:**
- A cada push
- A cada Pull Request
- Manualmente

**O que verifica:**
- ✅ Sintaxe JavaScript
- ✅ Estrutura de arquivos
- ✅ Variáveis de ambiente (.env.example)
- ✅ Dependências do package.json
- ✅ Segurança (sem credenciais commitadas)

---

## 🚀 Setup Inicial (Por Cliente)

### Passo 1: Configurar Secrets

1. Ir no repositório GitHub do cliente
2. Settings → Secrets and variables → Actions
3. New repository secret:
   - Name: `RAILWAY_TOKEN`
   - Value: (copiar de https://railway.app/account/tokens)

### Passo 2: Configurar Variables

1. Settings → Secrets and variables → Actions → Variables
2. New repository variable:
   - Name: `RAILWAY_URL`
   - Value: `https://xxxxx.up.railway.app` (URL do Railway)

### Passo 3: Ativar Workflows

1. Ir em Actions (no topo do repo)
2. Clicar "I understand my workflows, go ahead and enable them"
3. Pronto! Workflows estão ativos.

---

## 🔄 Como Funciona no Dia a Dia

### Cenário 1: Você atualiza o template principal
```
Você → Push no albertonpf-jpg/contatosync
  ↓
Segunda-feira 9h (ou manual)
  ↓
Workflow sync-upstream roda em TODOS os repos de clientes
  ↓
Merge automático das atualizações
  ↓
Railway detecta push e faz redeploy automático
```

### Cenário 2: Você corrige bug em cliente específico
```
Você → Push no repo do cliente (contatosync-loja-abc)
  ↓
Workflow tests.yml roda (verifica código)
  ↓
Workflow railway-deploy.yml roda (se tests passar)
  ↓
Deploy automático no Railway do cliente
```

---

## ⚙️ Configurações Avançadas

### Desabilitar sync automático

Se um cliente tiver customizações que não podem ser sobrescritas:

1. Ir em `.github/workflows/sync-upstream.yml`
2. Comentar a linha do `schedule:cron`
3. Manter apenas `workflow_dispatch` (manual)

### Adicionar notificações

#### Slack/Discord:
```yaml
- name: Notificar Slack
  if: failure()
  uses: slackapi/slack-github-action@v1
  with:
    webhook-url: ${{ secrets.SLACK_WEBHOOK }}
    payload: |
      {
        "text": "❌ Deploy falhou: ${{ github.repository }}"
      }
```

#### Email (via SendGrid):
```yaml
- name: Enviar email
  if: failure()
  uses: dawidd6/action-send-mail@v3
  with:
    server_address: smtp.sendgrid.net
    server_port: 587
    username: apikey
    password: ${{ secrets.SENDGRID_API_KEY }}
    subject: Deploy falhou - ContatoSync
    to: alberto@plannedmidia.com.br
    from: noreply@contatosync.com
    body: Erro no deploy do repositório ${{ github.repository }}
```

---

## 🐛 Troubleshooting

### Workflow não roda

**Problema:** Actions desabilitados
**Solução:** Settings → Actions → Allow all actions

### Deploy falha com "RAILWAY_TOKEN not found"

**Problema:** Secret não configurado
**Solução:** Adicionar `RAILWAY_TOKEN` nos Secrets

### Sync cria conflitos

**Problema:** Cliente tem customizações locais
**Solução:**
1. Resolver conflitos manualmente
2. Considerar desabilitar sync automático
3. Manter apenas sync manual quando necessário

### Railway não atualiza

**Problema:** Railway não está conectado ao GitHub
**Solução:**
1. Railway dashboard → Settings
2. Reconnect GitHub
3. Verificar se branch está correta (main)

---

## 📊 Monitoramento

### Ver histórico de execuções:
1. GitHub → Actions
2. Selecionar workflow
3. Ver lista de runs

### Ver logs detalhados:
1. Clicar em um run específico
2. Expandir cada step
3. Ver output completo

### Cancelar execução:
1. Clicar no run em andamento
2. "Cancel workflow"

---

## 🎯 Boas Práticas

✅ **Fazer:**
- Testar workflows manualmente antes de confiar no automático
- Monitorar primeira execução de cada cliente
- Manter RAILWAY_TOKEN seguro (nunca commitar)
- Verificar logs após cada deploy

❌ **Evitar:**
- Commitar secrets no código
- Fazer push direto sem testar localmente
- Ignorar falhas de workflow (investigar sempre)
- Desabilitar testes (eles pegam erros básicos)

---

## 💡 Dicas

### Executar workflow manualmente:
1. Actions → Selecionar workflow
2. "Run workflow" (direita)
3. Selecionar branch
4. "Run workflow"

### Notificar quando deploy concluir:
1. GitHub → Watch → Custom
2. Marcar "Workflows"
3. Receber email quando rodar

### Ver status no README:
Adicionar badge no README.md:
```markdown
![Deploy](https://github.com/usuario/repo/workflows/Deploy/badge.svg)
```

---

## 🔒 Segurança

- ✅ Secrets criptografados pelo GitHub
- ✅ Tokens Railway com escopo limitado
- ✅ Workflow verifica credenciais commitadas
- ✅ Logs não expõem secrets

---

## 📞 Suporte

Problemas com workflows?
- Verificar logs no Actions
- Consultar [GitHub Actions Docs](https://docs.github.com/actions)
- Contato: alberto@plannedmidia.com.br
