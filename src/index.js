'use strict';

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║                           🚀 CONTATOSYNC BACKEND                           ║
// ║                        Backend Express.js Completo                         ║
// ║                      ContatoSync WhatsApp → Contacts                       ║
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
        connected: false,
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
    contacts: [],
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
    // Simula geração de QR Code
    const qrData = `contatosync-auth-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    appState.whatsapp.qr = qrData;
    
    log('QR Code gerado para WhatsApp');
    broadcast('qr', { qr: qrData });
    
    // Simula conexão após 8-15 segundos
    setTimeout(() => {
        if (appState.whatsapp.qr === qrData) {
            connectWhatsApp();
        }
    }, Math.random() * 7000 + 8000);
    
    return qrData;
}

function connectWhatsApp() {
    appState.whatsapp.connected = true;
    appState.whatsapp.qr = null;
    appState.whatsapp.phone = '+55 11 99999-8888';
    appState.whatsapp.lastActivity = new Date().toISOString();
    
    log('WhatsApp conectado com sucesso!');
    broadcast('connected', {
        status: 'connected',
        phone: appState.whatsapp.phone,
        timestamp: appState.whatsapp.lastActivity
    });
    
    // Simula alguns contatos após conectar
    setTimeout(() => simulateContacts(), 3000);
}

function simulateContacts() {
    const fakeContacts = [
        { phone: '+55 11 98765-4321', name: null },
        { phone: '+55 11 95555-1234', name: null },
        { phone: '+55 21 97777-8888', name: null }
    ];
    
    fakeContacts.forEach((contact, index) => {
        setTimeout(() => {
            const contactData = {
                ...contact,
                pending: true,
                detected: new Date().toISOString(),
                id: `contact_${Date.now()}_${index}`
            };
            
            appState.contacts.push(contactData);
            appState.stats.total++;
            appState.stats.pending++;
            
            log(`Novo contato detectado: ${contact.phone}`);
            broadcast('contact', contactData);
        }, index * 2000);
    });
}

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
        version: '1.0.0'
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
        savedContacts: appState.contacts.filter(c => !c.pending)
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
        
        log('Iniciando conexão WhatsApp...');
        const qrCode = generateQR();
        
        res.json({
            ok: true,
            message: 'QR Code gerado',
            qr: qrCode
        });
        
    } catch (error) {
        log(`Erro ao conectar WhatsApp: ${error.message}`, 'error');
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
    // Simula fluxo OAuth do Google
    const authUrl = `https://accounts.google.com/oauth/authorize?client_id=fake&redirect_uri=${req.protocol}://${req.get('host')}/auth/google/callback&response_type=code&scope=https://www.googleapis.com/auth/contacts`;
    
    // Para demo, simula conexão imediata
    setTimeout(() => {
        appState.google.connected = true;
        appState.google.profile = {
            email: 'usuario@gmail.com',
            name: 'Usuário Demo'
        };
        
        log('Google Contacts conectado');
        broadcast('agenda-update', { google: true });
    }, 2000);
    
    res.send(`
        <html>
            <head><title>Google OAuth</title></head>
            <body style="font-family:Arial;text-align:center;padding:50px;background:#0a0a0a;color:white;">
                <h1 style="color:#4285f4;">🇬 Google OAuth</h1>
                <p>Conectando Google Contacts...</p>
                <p style="color:#25d366;">✅ Sucesso! Você pode fechar esta janela.</p>
                <script>
                    setTimeout(() => {
                        window.close();
                    }, 2000);
                </script>
            </body>
        </html>
    `);
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
                error: 'Apple ID e senha são obrigatórios'
            });
        }
        
        // Simula verificação de credenciais
        await new Promise(resolve => setTimeout(resolve, 1500));
        
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
        
        log(`Contato salvo manualmente: ${name} - ${phone}`);
        
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
    
    // Envia status inicial
    res.write(`event: status\ndata: ${JSON.stringify({
        status: appState.whatsapp.connected ? 'connected' : 'disconnected',
        googleConnected: appState.google.connected,
        icloudConnected: appState.icloud.connected,
        savedToday: appState.stats.savedToday,
        pendingContacts: appState.contacts.filter(c => c.pending),
        savedContacts: appState.contacts.filter(c => !c.pending)
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
                        </style>
                    </head>
                    <body>
                        <div class="container">
                            <h1>🚀 ContatoSync</h1>
                            <div class="status">
                                <h3>✅ Backend Online</h3>
                                <p>Servidor funcionando perfeitamente!</p>
                                <p><strong>Status:</strong> Aguardando interface...</p>
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
    log(`🔧 Modo: ${process.env.NODE_ENV || 'development'}`);
    log(`📊 PID: ${process.pid}`);
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
