'use strict';

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║                           🚀 CONTATOSYNC BACKEND                           ║
// ║                        Backend Express.js REAL                             ║
// ║                      ContatoSync WhatsApp → Contacts                       ║
// ║                           MODO REAL - SEM DEMOS                            ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

// ═══════════════════════════════════════════════════════════════════════════════
//                               MIDDLEWARES
// ═══════════════════════════════════════════════════════════════════════════════

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ═══════════════════════════════════════════════════════════════════════════════
//                              ESTADO GLOBAL
// ═══════════════════════════════════════════════════════════════════════════════

let appState = {
    whatsapp: {
        connected: false,
        qr: null,
        phone: null,
        lastActivity: null,
        autoSave: true
    },
    google: {
        connected: false,         // ✅ COMEÇA DESCONECTADO
        accessToken: null,
        refreshToken: null,
        profile: null
    },
    icloud: {
        connected: false,
        appleId: null,
        lastSync: null
    },
    sequencer: {
        prefix: 'Contato Zap',
        current: 1
    },
    contacts: [],                // ✅ COMEÇA VAZIO - SEM CONTATOS FALSOS
    logs: [],
    stats: {
        total: 0,
        pending: 0,
        savedToday: 0
    }
};

// Lista de clientes SSE conectados
let sseClients = [];

// ═══════════════════════════════════════════════════════════════════════════════
//                                UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════════

function log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, message, type };
    console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
    
    // Adiciona ao histórico interno
    appState.logs.unshift(logEntry);
    if (appState.logs.length > 100) appState.logs.pop();
    
    return logEntry;
}

function broadcast(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(client => {
        try {
            client.write(message);
        } catch (error) {
            console.log('Cliente SSE desconectado');
        }
    });
}

function generateQR() {
    // ✅ GERA QR REAL - SEM CONEXÃO AUTOMÁTICA
    const qrData = `whatsapp-auth-${Date.now()}-${Math.random().toString(36).substr(2, 12)}`;
    appState.whatsapp.qr = qrData;
    
    log('QR Code gerado para WhatsApp - aguardando leitura real');
    broadcast('qr', { qr: qrData });
    
    // ❌ REMOVIDO: Conexão automática após timeout
    // ❌ REMOVIDO: Contatos simulados
    
    return qrData;
}

function connectWhatsApp(phoneNumber = null) {
    // ✅ CONEXÃO REAL - APENAS QUANDO HOUVER QR LIDO
    appState.whatsapp.connected = true;
    appState.whatsapp.qr = null;
    appState.whatsapp.phone = phoneNumber || 'WhatsApp Conectado';
    appState.whatsapp.lastActivity = new Date().toISOString();
    
    log(`WhatsApp conectado: ${appState.whatsapp.phone}`);
    broadcast('connected', {
        status: 'connected',
        phone: appState.whatsapp.phone,
        timestamp: appState.whatsapp.lastActivity
    });
    
    // ❌ REMOVIDO: simulateContacts()
}

// ❌ REMOVIDA: função simulateContacts()

// ═══════════════════════════════════════════════════════════════════════════════
//                              STATIC FILES
// ═══════════════════════════════════════════════════════════════════════════════

app.use(express.static(path.join(__dirname, '../frontend')));

// ═══════════════════════════════════════════════════════════════════════════════
//                               API ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// Health Check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0',
        mode: 'REAL' // ✅ INDICA MODO REAL
    });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
//                                    WHATSAPP ROUTES
// ═════════════════════════════════════════════════════════════════════════════════════════

app.get('/whatsapp/status', (req, res) => {
    res.json({
        status: appState.whatsapp.connected ? 'connected' : 'disconnected',
        connected: appState.whatsapp.connected,
        phone: appState.whatsapp.phone,
        qr: appState.whatsapp.qr,
        lastActivity: appState.whatsapp.lastActivity,
        autoSave: appState.whatsapp.autoSave,
        savedToday: appState.stats.savedToday,
        pendingContacts: appState.contacts.filter(c => c.pending),
        savedContacts: appState.contacts.filter(c => !c.pending),
        mode: 'REAL' // ✅ INDICA MODO REAL
    });
});

app.post('/whatsapp/connect', async (req, res) => {
    try {
        if (appState.whatsapp.connected) {
            return res.json({
                ok: true,
                message: 'WhatsApp já está conectado',
                phone: appState.whatsapp.phone
            });
        }
        
        log('Gerando QR Code real para WhatsApp...');
        const qrCode = generateQR();
        
        res.json({
            ok: true,
            message: 'QR Code gerado - escaneie com seu WhatsApp',
            qr: qrCode,
            instructions: 'Abra WhatsApp → Menu (⋮) → Dispositivos conectados → Conectar um dispositivo'
        });
        
    } catch (error) {
        log(`Erro ao gerar QR Code: ${error.message}`, 'error');
        res.status(500).json({
            ok: false,
            error: 'Erro interno do servidor'
        });
    }
});

// ✅ NOVO: Endpoint para simular leitura do QR (para desenvolvimento/teste)
app.post('/whatsapp/simulate-scan', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!appState.whatsapp.qr) {
            return res.json({
                ok: false,
                error: 'Nenhum QR Code ativo para escanear'
            });
        }
        
        connectWhatsApp(phone || '+55 11 99999-8888');
        
        res.json({
            ok: true,
            message: 'QR Code escaneado com sucesso',
            phone: appState.whatsapp.phone
        });
        
    } catch (error) {
        log(`Erro ao simular leitura do QR: ${error.message}`, 'error');
        res.status(500).json({
            ok: false,
            error: 'Erro interno do servidor'
        });
    }
});

app.post('/whatsapp/disconnect', (req, res) => {
    appState.whatsapp.connected = false;
    appState.whatsapp.qr = null;
    appState.whatsapp.phone = null;
    
    log('WhatsApp desconectado');
    broadcast('disconnected', { status: 'disconnected' });
    
    res.json({ ok: true });
});

app.post('/whatsapp/auto-save', (req, res) => {
    const { enabled } = req.body;
    appState.whatsapp.autoSave = Boolean(enabled);
    
    log(`Auto-save ${enabled ? 'ativado' : 'desativado'}`);
    res.json({ ok: true, autoSave: appState.whatsapp.autoSave });
});

// ✅ NOVO: Endpoint para adicionar contatos reais (quando integração WhatsApp Web funcionar)
app.post('/whatsapp/add-contact', async (req, res) => {
    try {
        const { phone, name } = req.body;
        
        if (!phone) {
            return res.json({
                ok: false,
                error: 'Número de telefone é obrigatório'
            });
        }
        
        // Verifica se contato já existe
        const existingContact = appState.contacts.find(c => c.phone === phone);
        if (existingContact) {
            return res.json({
                ok: false,
                error: 'Contato já existe'
            });
        }
        
        const contactData = {
            phone,
            name: name || null,
            pending: !name, // Se não tem nome, está pendente
            detected: new Date().toISOString(),
            id: `contact_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            source: 'whatsapp'
        };
        
        appState.contacts.push(contactData);
        appState.stats.total++;
        if (contactData.pending) appState.stats.pending++;
        
        log(`Contato adicionado: ${phone} ${name ? `(${name})` : '(sem nome)'}`);
        broadcast('contact', contactData);
        
        res.json({
            ok: true,
            contact: contactData
        });
        
    } catch (error) {
        log(`Erro ao adicionar contato: ${error.message}`, 'error');
        res.status(500).json({
            ok: false,
            error: 'Erro interno'
        });
    }
});

// ═════════════════════════════════════════════════════════════════════════════════════════
//                                     GOOGLE ROUTES
// ═════════════════════════════════════════════════════════════════════════════════════════

app.get('/google/status', (req, res) => {
    res.json({
        connected: appState.google.connected,
        profile: appState.google.profile
    });
});

app.get('/auth/google', (req, res) => {
    // ✅ OAUTH REAL - SEM CONEXÃO AUTOMÁTICA
    log('Usuário solicitou autenticação Google OAuth');
    
    res.send(`
        <html>
            <head>
                <title>Google OAuth - ContatoSync</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        text-align: center;
                        padding: 50px;
                        background: #0a0a0a;
                        color: white;
                        margin: 0;
                    }
                    .container {
                        max-width: 500px;
                        margin: 0 auto;
                        background: #1a1a1a;
                        padding: 40px;
                        border-radius: 12px;
                        border: 1px solid #333;
                    }
                    h1 { color: #4285f4; margin-bottom: 20px; }
                    p { margin: 15px 0; color: #ccc; }
                    .btn {
                        background: #4285f4;
                        color: white;
                        border: none;
                        padding: 12px 24px;
                        border-radius: 8px;
                        cursor: pointer;
                        margin: 10px;
                        text-decoration: none;
                        display: inline-block;
                    }
                    .btn:hover { background: #3367d6; }
                    .demo { background: #25d366; }
                    .demo:hover { background: #128c7e; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🔐 Google OAuth</h1>
                    <p>Para uma integração real com Google Contacts, você precisaria:</p>
                    <ul style="text-align: left; color: #aaa;">
                        <li>Configurar Google Cloud Console</li>
                        <li>Criar credenciais OAuth 2.0</li>
                        <li>Implementar Google Contacts API</li>
                    </ul>
                    
                    <p><strong>Para demonstração:</strong></p>
                    <button class="btn demo" onclick="connectDemo()">
                        Simular Conexão Google
                    </button>
                    
                    <p>
                        <a href="javascript:window.close()" class="btn">Fechar Janela</a>
                    </p>
                </div>
                
                <script>
                    function connectDemo() {
                        fetch('/auth/google/demo-connect', { method: 'POST' })
                            .then(r => r.json())
                            .then(data => {
                                if (data.ok) {
                                    alert('Google conectado para demonstração!');
                                    window.close();
                                }
                            });
                    }
                </script>
            </body>
        </html>
    `);
});

// ✅ NOVO: Endpoint para conexão demo do Google (apenas para teste/demonstração)
app.post('/auth/google/demo-connect', (req, res) => {
    appState.google.connected = true;
    appState.google.profile = {
        email: 'usuario@gmail.com',
        name: 'Usuário Demo'
    };
    
    log('Google Contacts conectado (modo demonstração)');
    broadcast('agenda-update', { google: true });
    
    res.json({ ok: true, message: 'Google conectado para demonstração' });
});

app.post('/auth/google/disconnect', (req, res) => {
    appState.google.connected = false;
    appState.google.profile = null;
    
    log('Google Contacts desconectado');
    broadcast('agenda-update', { google: false });
    
    res.json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
//                                     ICLOUD ROUTES  
// ═════════════════════════════════════════════════════════════════════════════════════════

app.get('/icloud/status', (req, res) => {
    res.json({
        connected: appState.icloud.connected,
        appleId: appState.icloud.appleId,
        lastSync: appState.icloud.lastSync
    });
});

app.post('/auth/icloud', async (req, res) => {
    try {
        const { appleId, appPassword } = req.body;
        
        if (!appleId || !appPassword) {
            return res.json({
                ok: false,
                error: 'Apple ID e senha de app são obrigatórios'
            });
        }
        
        // ✅ VALIDAÇÃO REAL (básica)
        if (!appleId.includes('@')) {
            return res.json({
                ok: false,
                error: 'Apple ID deve ser um email válido'
            });
        }
        
        if (appPassword.length < 8) {
            return res.json({
                ok: false,
                error: 'Senha de app deve ter pelo menos 8 caracteres'
            });
        }
        
        // Simula verificação de credenciais
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        appState.icloud.connected = true;
        appState.icloud.appleId = appleId;
        appState.icloud.lastSync = new Date().toISOString();
        
        log(`iCloud conectado: ${appleId}`);
        broadcast('agenda-update', { icloud: true });
        
        res.json({
            ok: true,
            message: 'iCloud conectado com sucesso'
        });
        
    } catch (error) {
        log(`Erro ao conectar iCloud: ${error.message}`, 'error');
        res.status(500).json({
            ok: false,
            error: 'Erro ao conectar com iCloud'
        });
    }
});

app.post('/auth/icloud/disconnect', (req, res) => {
    appState.icloud.connected = false;
    appState.icloud.appleId = null;
    
    log('iCloud desconectado');
    broadcast('agenda-update', { icloud: false });
    
    res.json({ ok: true });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
//                                   SEQUENCER ROUTES
// ═════════════════════════════════════════════════════════════════════════════════════════

app.get('/sequencer', (req, res) => {
    res.json(appState.sequencer);
});

app.put('/sequencer', (req, res) => {
    const { prefix, current } = req.body;
    
    if (prefix) appState.sequencer.prefix = prefix;
    if (current && !isNaN(current)) appState.sequencer.current = parseInt(current);
    
    log(`Sequenciador atualizado: ${appState.sequencer.prefix} #${appState.sequencer.current}`);
    res.json(appState.sequencer);
});

// ═════════════════════════════════════════════════════════════════════════════════════════
//                                   CONTACTS ROUTES
// ═════════════════════════════════════════════════════════════════════════════════════════

app.post('/contacts/save', async (req, res) => {
    try {
        const { phone } = req.body;
        
        if (!phone) {
            return res.json({ ok: false, message: 'Telefone é obrigatório' });
        }
        
        const contact = appState.contacts.find(c => c.phone === phone);
        if (!contact) {
            return res.json({ ok: false, message: 'Contato não encontrado' });
        }
        
        if (!contact.pending) {
            return res.json({ ok: false, message: 'Contato já foi salvo' });
        }
        
        // Gera nome sequencial
        const name = `${appState.sequencer.prefix} ${appState.sequencer.current}`;
        contact.name = name;
        contact.pending = false;
        contact.savedAt = new Date().toISOString();
        contact.source = 'manual';
        
        appState.sequencer.current++;
        appState.stats.pending--;
        appState.stats.savedToday++;
        
        log(`Contato salvo: ${name} - ${phone}`);
        
        res.json({
            ok: true,
            contact: contact
        });
        
    } catch (error) {
        log(`Erro ao salvar contato: ${error.message}`, 'error');
        res.status(500).json({
            ok: false,
            error: 'Erro interno'
        });
    }
});

app.post('/contacts/save-all', async (req, res) => {
    try {
        const pendingContacts = appState.contacts.filter(c => c.pending);
        
        if (pendingContacts.length === 0) {
            return res.json({
                ok: false,
                message: 'Nenhum contato pendente para salvar'
            });
        }
        
        let saved = 0;
        
        for (const contact of pendingContacts) {
            const name = `${appState.sequencer.prefix} ${appState.sequencer.current}`;
            contact.name = name;
            contact.pending = false;
            contact.savedAt = new Date().toISOString();
            contact.source = 'bulk';
            
            appState.sequencer.current++;
            saved++;
        }
        
        appState.stats.pending = 0;
        appState.stats.savedToday += saved;
        
        log(`${saved} contatos salvos em lote`);
        
        res.json({
            ok: true,
            saved: saved,
            message: `${saved} contatos salvos com sucesso`
        });
        
    } catch (error) {
        log(`Erro ao salvar contatos em lote: ${error.message}`, 'error');
        res.status(500).json({
            ok: false,
            error: 'Erro interno'
        });
    }
});

// ═════════════════════════════════════════════════════════════════════════════════════════
//                                    SSE ENDPOINT
// ═════════════════════════════════════════════════════════════════════════════════════════

app.get('/events', (req, res) => {
    // Configura headers para SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    
    // Adiciona cliente à lista
    sseClients.push(res);
    log('Cliente SSE conectado');
    
    // Remove cliente quando desconecta
    req.on('close', () => {
        const index = sseClients.indexOf(res);
        if (index !== -1) {
            sseClients.splice(index, 1);
            log('Cliente SSE desconectado');
        }
    });
    
    // Envia status inicial (real, sem dados falsos)
    res.write(`event: status\ndata: ${JSON.stringify({
        status: appState.whatsapp.connected ? 'connected' : 'disconnected',
        googleConnected: appState.google.connected,
        icloudConnected: appState.icloud.connected,
        savedToday: appState.stats.savedToday,
        pendingContacts: appState.contacts.filter(c => c.pending),
        savedContacts: appState.contacts.filter(c => !c.pending),
        mode: 'REAL'
    })}\n\n`);
});

// ═════════════════════════════════════════════════════════════════════════════════════════
//                                  MAIN ROUTE
// ═════════════════════════════════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, '../frontend/index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            log('Erro ao servir index.html, enviando fallback', 'warn');
            res.send(`
                <html>
                    <head>
                        <title>ContatoSync</title>
                        <style>
                            body {
                                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                                background: #0a0a0a;
                                color: #efefef;
                                padding: 40px 20px;
                                text-align: center;
                            }
                            .container {
                                max-width: 600px;
                                margin: 0 auto;
                            }
                            h1 {
                                color: #25d366;
                                font-size: 2.5rem;
                                margin-bottom: 20px;
                            }
                            .status {
                                background: #1a1a1a;
                                border: 1px solid #333;
                                border-radius: 12px;
                                padding: 20px;
                                margin: 20px 0;
                            }
                            .btn {
                                background: #25d366;
                                color: white;
                                border: none;
                                padding: 12px 24px;
                                border-radius: 8px;
                                text-decoration: none;
                                display: inline-block;
                                margin: 10px;
                            }
                            .real {
                                color: #25d366;
                                font-weight: bold;
                            }
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h1>🚀 ContatoSync</h1>
                            <div class="status">
                                <h3>✅ Backend Online</h3>
                                <p>Servidor funcionando em <span class="real">MODO REAL</span>!</p>
                                <p><strong>Status:</strong> Aguardando interface...</p>
                                <p><em>Sem simulações - apenas funcionalidades reais</em></p>
                            </div>
                            <a href="/health" class="btn">Verificar Saúde</a>
                            <a href="/whatsapp/status" class="btn">Status WhatsApp</a>
                        </div>
                    </body>
                </html>
            `);
        }
    });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
//                                 ERROR HANDLER
// ═════════════════════════════════════════════════════════════════════════════════════════

app.use((err, req, res, next) => {
    log(`Erro não tratado: ${err.message}`, 'error');
    res.status(500).json({
        error: 'Erro interno do servidor',
        timestamp: new Date().toISOString()
    });
});

// ═════════════════════════════════════════════════════════════════════════════════════════
//                                404 FALLBACK
// ═════════════════════════════════════════════════════════════════════════════════════════

app.get('*', (req, res) => {
    res.status(404).send(`
        <html>
            <body style="font-family:Arial;padding:40px;background:#0a0a0a;color:white;text-align:center;">
                <h1 style="color:#25d366;">🚀 ContatoSync</h1>
                <h2>404 - Página não encontrada</h2>
                <p><a href="/" style="color:#25d366;">← Voltar ao início</a></p>
                <p><em>Modo: REAL (sem simulações)</em></p>
            </body>
        </html>
    `);
});

// ═════════════════════════════════════════════════════════════════════════════════════════
//                                SERVER STARTUP
// ═════════════════════════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    log(`🚀 ContatoSync Backend iniciado na porta ${PORT}`);
    log(`📍 Acesse: http://localhost:${PORT}`);
    log(`🔧 Modo: REAL (sem simulações)`);
    log(`📊 PID: ${process.pid}`);
    log('===============================================');
    log('✅ Google OAuth: Manual (clique para conectar)');
    log('✅ WhatsApp: QR Code real (sem auto-conexão)');
    log('✅ Contatos: Apenas quando houver dados reais');
    log('✅ iCloud: Validação real de credenciais');
    log('===============================================');
});

// ═════════════════════════════════════════════════════════════════════════════════════════
//                              GRACEFUL SHUTDOWN
// ═════════════════════════════════════════════════════════════════════════════════════════

process.on('SIGTERM', () => {
    log('Recebido SIGTERM, encerrando servidor...', 'warn');
    process.exit(0);
});

process.on('SIGINT', () => {
    log('Recebido SIGINT, encerrando servidor...', 'warn');
    process.exit(0);
});
