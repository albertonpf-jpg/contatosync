# 🌐 ContatoSync - URLs de Produção

**Deployado em:** 01/04/2026

---

## 📱 Landing Page (Vendas)

**URL Principal:** https://contatosync-landing.vercel.app

**Uso:**
- Enviar para leads interessados
- Compartilhar em redes sociais
- Link em assinatura de email
- QR Code para eventos

**Personalizar:**
- WhatsApp: Trocar `5511999999999`
- Email: Trocar `alberto@plannedmidia.com.br`
- Preços: Editar se necessário

---

## 🎛️ Painel Admin (Gestão)

**URL Principal:** https://contatosync-admin.vercel.app

**Login:**
- Senha padrão: `admin123`
- ⚠️ **ALTERE em `admin/settings.js` e faça redeploy!**

**Uso:**
- Gerenciar clientes
- Acompanhar financeiro
- Visualizar estatísticas
- Checklist de setup

**Dados:**
- Salvos no localStorage do navegador
- Fazer backup regularmente (botão Export)
- Importar em outro navegador se necessário

---

## 🔄 Atualizar Páginas

Sempre que fizer alterações nos arquivos locais:

```bash
# Landing Page
cd ~/Documents/contatosync/landing
vercel --prod

# Painel Admin
cd ~/Documents/contatosync/admin
vercel --prod
```

Ou fazer push no GitHub e configurar deploy automático:
- Vercel Dashboard → Settings → Git
- Conectar repositório
- Deploy automático a cada push

---

## 🎯 Próximos Passos

### 1. Alterar Senha Admin
```javascript
// admin/settings.js
adminPassword: 'SUA_SENHA_FORTE_AQUI',
```
Depois: `cd admin && vercel --prod`

### 2. Personalizar Landing
```html
<!-- landing/index.html -->
<!-- Trocar WhatsApp, Email, Preços -->
```
Depois: `cd landing && vercel --prod`

### 3. Domínio Próprio (Opcional)
- Comprar: contatosync.com.br
- Vercel → Settings → Domains
- Adicionar domínio customizado
- Configurar DNS (Vercel fornece instruções)

**URLs com domínio próprio:**
- Landing: `https://contatosync.com.br`
- Admin: `https://admin.contatosync.com.br`

---

## 📊 Analytics (Recomendado)

### Google Analytics 4
1. Criar propriedade em analytics.google.com
2. Copiar ID (G-XXXXXXXXXX)
3. Adicionar em `landing/index.html`:
```html
<head>
  ...
  <!-- Google Analytics -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-XXXXXXXXXX');
  </script>
</head>
```
4. Redeploy: `vercel --prod`

### Facebook Pixel (Opcional)
Similar ao GA, adicionar código no `<head>`

---

## 🔒 Segurança

### Painel Admin:
- ✅ Alterar senha padrão
- ✅ Não compartilhar URL publicamente
- ✅ Usar HTTPS (Vercel fornece automático)
- ✅ Fazer backup dos dados regularmente

### Landing Page:
- ✅ Validar formulário (já implementado)
- ✅ Proteção contra spam (considerar reCAPTCHA)
- ✅ HTTPS obrigatório

---

## 📞 Suporte Vercel

- Dashboard: https://vercel.com/dashboard
- Docs: https://vercel.com/docs
- Logs: Vercel Dashboard → Deployments → View Logs
- Redeploy: Vercel Dashboard → Deployments → Redeploy

---

**Tudo pronto para começar a vender! 🚀**
