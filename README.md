# ContatoSync

Salva automaticamente contatos do WhatsApp na sua agenda — Google Contacts ou iCloud.

---

## Instalação rápida

### Windows
Dê duplo clique em `instalar.bat`

### Mac / Linux
```bash
chmod +x instalar.sh && ./instalar.sh
```

---

## Iniciar o app

### Windows
Dê duplo clique em `iniciar.bat`

### Mac / Linux
```bash
./iniciar.sh
```

O navegador abrirá automaticamente em `http://localhost:3000`

---

## Configuração do Google Contacts (necessária uma vez)

1. Acesse https://console.cloud.google.com
2. Crie um projeto (ex: "ContatoSync")
3. Ative a **People API**: APIs e serviços → Biblioteca → "People API"
4. Crie credenciais: Credenciais → Criar → ID do cliente OAuth → Aplicativo da Web
5. Em "URIs de redirecionamento autorizados" adicione:
   `http://localhost:3000/auth/google/callback`
6. Copie o **Client ID** e **Client Secret** para o arquivo `.env`

---

## Configuração do iCloud (Apple)

A Apple exige uma **App-Specific Password** para apps de terceiros:

1. Acesse https://appleid.apple.com
2. Faça login com seu Apple ID
3. Segurança → Senhas para apps → Gerar senha
4. Use essa senha (formato `xxxx-xxxx-xxxx-xxxx`) no ContatoSync

---

## Estrutura do projeto

```
contatosync/
├── src/
│   ├── index.js       → Servidor principal
│   ├── whatsapp.js    → Conexão WhatsApp (Baileys)
│   ├── google.js      → Google Contacts (OAuth2)
│   ├── icloud.js      → iCloud (CardDAV)
│   └── sequencer.js   → Nomes sequenciais
├── frontend/
│   └── index.html     → Interface web
├── config/            → Gerado automaticamente (sessões e tokens)
├── .env               → Suas configurações (não compartilhar)
├── instalar.bat       → Instalação Windows
├── iniciar.bat        → Iniciar Windows
├── instalar.sh        → Instalação Mac/Linux
└── iniciar.sh         → Iniciar Mac/Linux
```
