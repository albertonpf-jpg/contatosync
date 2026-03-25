'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const QRCode = require('qrcode');
const axios = require('axios');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const config = {
    google: {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirectUri: process.env.GOOGLE_REDIRECT_URI || 'https://web-production-a17bb.up.railway.app/auth/google/callback'
    },
    whatsapp: { sessionPath: './whatsapp_session' }
};

let appState = {
    whatsapp: { connected: false, qr: null, phone: null, lastActivity: null, autoSave: true, socket: null },
    google: { connected: false, accessToken: null, refreshToken: null, profile: null, oauth2Client: null },
    icloud: { connected: false, appleId: null, lastSync: null },
    sequencer: { prefix: 'Contato Zap', current: 1 },
    contacts: [], logs: [],
    stats: { total: 0, pending: 0, savedToday: 0 }
};

let sseClients = [];
let baileysModule = null;

// Logger compatível com Baileys (precisa do método .child())
function makeSilentLogger() {
    const noop = () => {};
    const logger = {
        level: 'silent',
        trace: noop, debug: noop, info: noop,
        warn: noop, error: noop, fatal: noop,
        child: () => makeSilentLogger()
    };
    return logger;
}

async function loadBaileys() {
    if (baileysModule) return baileysModule;
    baileysModule = await import('@whiskeysockets/baileys');
    return baileysModule;
}

function log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
    appState.logs.unshift({ timestamp, message, type });
    if (appState.logs.length > 100) appState.logs.pop();
}

function broadcast(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(client => {
        try { client.write(message); } catch (e) {}
    });
}

async function initWhatsApp() {
    try {
        const { makeWASocket, useMultiFileAuthState, DisconnectReason } = await loadBaileys();

        if (!fs.existsSync(config.whatsapp.sessionPath)) {
            fs.mkdirSync(config.whatsapp.sessionPath, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(config.whatsapp.sessionPath);

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: makeSilentLogger()
        });

        appState.whatsapp.socket = sock;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                try {
                    const qrCodeUrl = await QRCode.toDataURL(qr);
                    appState.whatsapp.qr = qrCodeUrl;
                    log('QR Code gerado');
                    broadcast('qr', { qr: qrCodeUrl });
                } catch (e) { log(`Erro QR: ${e.message}`, 'error'); }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const { DisconnectReason: DR } = await loadBaileys();
                const shouldReconnect = statusCode !== DR.loggedOut;
                log(`Conexão fechada. Reconectando: ${shouldReconnect}`);
                appState.whatsapp.connected = false;
                appState.whatsapp.phone = null;
                appState.whatsapp.qr = null;
                broadcast('disconnected', { status: 'disconnected' });
                if (shouldReconnect) setTimeout(() => initWhatsApp(), 3000);
            } else if (connection === 'open') {
                appState.whatsapp.connected = true;
                appState.whatsapp.qr = null;
                appState.whatsapp.phone = sock.user?.id || 'Conectado';
                appState.whatsapp.lastActivity = new Date().toISOString();
                log(`WhatsApp conectado: ${appState.whatsapp.phone}`);
                broadcast('connected', { status: 'connected', phone: appState.whatsapp.phone });
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('contacts.update', (contacts) => {
            contacts.forEach(c => {
                if (c.id && c.name) addNewContact(c.id.replace('@s.whatsapp.net', ''), c.name);
            });
        });

        sock.ev.on('messages.upsert', ({ messages }) => {
            messages.forEach(msg => {
                if (msg.key?.remoteJid && !msg.key.fromMe) {
                    addNewContact(msg.key.remoteJid.replace('@s.whatsapp.net', ''), msg.pushName || null);
                }
            });
        });

        return sock;
    } catch (error) {
        log(`Erro ao inicializar WhatsApp: ${error.message}`, 'error');
        throw error;
    }
}

function addNewContact(phoneNumber, name = null) {
    if (appState.contacts.find(c => c.phone === phoneNumber)) return;
    const contact = {
        phone: phoneNumber, name, pending: !name,
        detected: new Date().toISOString(),
        id: `contact_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        source: 'whatsapp'
    };
    appState.contacts.push(contact);
    appState.stats.total++;
    if (contact.pending) appState.stats.pending++;
    log(`Novo contato: ${phoneNumber} ${name ? `(${name})` : ''}`);
    broadcast('contact', contact);
}

function initGoogleOAuth() {
    const oauth2Client = new google.auth.OAuth2(
        config.google.clientId, config.google.clientSecret, config.google.redirectUri
    );
    appState.google.oauth2Client = oauth2Client;
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/contacts.readonly',
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/userinfo.email'
        ]
    });
}

async function handleGoogleCallback(code) {
    const { tokens } = await appState.google.oauth2Client.getToken(code);
    appState.google.oauth2Client.setCredentials(tokens);
    appState.google.accessToken = tokens.access_token;
    appState.google.refreshToken = tokens.refresh_token;
    const oauth2 = google.oauth2('v2');
    const userInfo = await oauth2.userinfo.get({ auth: appState.google.oauth2Client });
    appState.google.profile = { email: userInfo.data.email, name: userInfo.data.name, picture: userInfo.data.picture };
    appState.google.connected = true;
    log(`Google conectado: ${appState.google.profile.email}`);
    broadcast('agenda-update', { google: true, profile: appState.google.profile });
    return { ok: true, profile: appState.google.profile };
}

async function connectICloud(appleId, appPassword) {
    const response = await axios({
        method: 'PROPFIND',
        url: `https://contacts.icloud.com/`,
        auth: { username: appleId, password: appPassword },
        headers: { 'Content-Type': 'application/xml', 'Depth': '0' },
        data: `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/></D:prop></D:propfind>`,
        timeout: 10000
    });
    if (response.status === 207 || response.status === 200) {
        appState.icloud.connected = true;
        appState.icloud.appleId = appleId;
        appState.icloud.lastSync = new Date().toISOString();
        log(`iCloud conectado: ${appleId}`);
        broadcast('agenda-update', { icloud: true });
        return { ok: true, message: 'iCloud conectado' };
    }
    throw new Error('Falha na conexão iCloud');
}

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), mode: 'PRODUCTION' });
});

app.get('/whatsapp/status', (req, res) => {
    res.json({
        status: appState.whatsapp.connected ? 'connected' : 'disconnected',
        connected: appState.whatsapp.connected,
        phone: appState.whatsapp.phone,
        qr: appState.whatsapp.qr,
        autoSave: appState.whatsapp.autoSave,
        savedToday: appState.stats.savedToday,
        pendingContacts: appState.contacts.filter(c => c.pending),
        savedContacts: appState.contacts.filter(c => !c.pending)
    });
});

app.post('/whatsapp/connect', async (req, res) => {
    try {
        if (appState.whatsapp.connected) return res.json({ ok: true, message: 'Já conectado', phone: appState.whatsapp.phone });
        log('Iniciando WhatsApp...');
        await initWhatsApp();
        res.json({ ok: true, message: 'Conectando... aguarde o QR Code' });
    } catch (error) {
        log(`Erro connect: ${error.message}`, 'error');
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.post('/whatsapp/disconnect', (req, res) => {
    try {
        if (appState.whatsapp.socket) appState.whatsapp.socket.logout?.();
        appState.whatsapp.connected = false;
        appState.whatsapp.qr = null;
        appState.whatsapp.phone = null;
        appState.whatsapp.socket = null;
        if (fs.existsSync(config.whatsapp.sessionPath)) {
            fs.rmSync(config.whatsapp.sessionPath, { recursive: true, force: true });
        }
        broadcast('disconnected', { status: 'disconnected' });
        res.json({ ok: true });
    } catch (e) { res.json({ ok: true }); }
});

app.get('/google/status', (req, res) => {
    res.json({ connected: appState.google.connected, profile: appState.google.profile });
});

app.get('/auth/google', (req, res) => {
    try { res.redirect(initGoogleOAuth()); }
    catch (e) { res.status(500).send('<html><body><h1>Erro OAuth</h1><button onclick="window.close()">Fechar</button></body></html>'); }
});

app.get('/auth/google/callback', async (req, res) => {
    try {
        const { code, error } = req.query;
        if (error) throw new Error(error);
        if (!code) throw new Error('Código não encontrado');
        const result = await handleGoogleCallback(code);
        res.send(`<html><body style="font-family:Arial;text-align:center;padding:50px;background:#0a0a0a;color:white">
            <h1 style="color:#25d366">✅ Google Conectado!</h1>
            <p>Bem-vindo, <strong>${result.profile.name}</strong></p>
            <p>${result.profile.email}</p>
            <script>setTimeout(()=>window.close(),2000)</script>
        </body></html>`);
    } catch (e) {
        res.send(`<html><body style="text-align:center;padding:50px"><h1>Erro</h1><p>${e.message}</p><button onclick="window.close()">Fechar</button></body></html>`);
    }
});

app.post('/auth/google/disconnect', (req, res) => {
    appState.google.connected = false; appState.google.profile = null;
    appState.google.accessToken = null; appState.google.oauth2Client = null;
    broadcast('agenda-update', { google: false });
    res.json({ ok: true });
});

app.get('/icloud/status', (req, res) => {
    res.json({ connected: appState.icloud.connected, appleId: appState.icloud.appleId });
});

app.post('/auth/icloud', async (req, res) => {
    try {
        const { appleId, appPassword } = req.body;
        if (!appleId || !appPassword) return res.json({ ok: false, error: 'Dados obrigatórios' });
        const result = await connectICloud(appleId, appPassword);
        res.json(result);
    } catch (e) {
        if (e.response?.status === 401) return res.status(401).json({ ok: false, error: 'Credenciais inválidas' });
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/auth/icloud/disconnect', (req, res) => {
    appState.icloud.connected = false; appState.icloud.appleId = null;
    broadcast('agenda-update', { icloud: false });
    res.json({ ok: true });
});

app.get('/sequencer', (req, res) => res.json(appState.sequencer));

app.put('/sequencer', (req, res) => {
    const { prefix, current } = req.body;
    if (prefix) appState.sequencer.prefix = prefix;
    if (current && !isNaN(current)) appState.sequencer.current = parseInt(current);
    res.json(appState.sequencer);
});

app.post('/contacts/save', (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.json({ ok: false, message: 'Telefone obrigatório' });
    const contact = appState.contacts.find(c => c.phone === phone);
    if (!contact) return res.json({ ok: false, message: 'Não encontrado' });
    if (!contact.pending) return res.json({ ok: false, message: 'Já salvo' });
    const name = `${appState.sequencer.prefix} ${appState.sequencer.current}`;
    contact.name = name; contact.pending = false;
    contact.savedAt = new Date().toISOString(); contact.source = 'manual';
    appState.sequencer.current++; appState.stats.pending--; appState.stats.savedToday++;
    res.json({ ok: true, contact });
});

app.post('/contacts/save-all', (req, res) => {
    const pending = appState.contacts.filter(c => c.pending);
    if (!pending.length) return res.json({ ok: false, message: 'Nenhum pendente' });
    let saved = 0;
    pending.forEach(c => {
        c.name = `${appState.sequencer.prefix} ${appState.sequencer.current}`;
        c.pending = false; c.savedAt = new Date().toISOString(); c.source = 'bulk';
        appState.sequencer.current++; saved++;
    });
    appState.stats.pending = 0; appState.stats.savedToday += saved;
    res.json({ ok: true, saved, message: `${saved} contatos salvos` });
});

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    sseClients.push(res);
    req.on('close', () => {
        const i = sseClients.indexOf(res);
        if (i !== -1) sseClients.splice(i, 1);
    });
    res.write(`event: status\ndata: ${JSON.stringify({
        status: appState.whatsapp.connected ? 'connected' : 'disconnected',
        googleConnected: appState.google.connected,
        icloudConnected: appState.icloud.connected,
        savedToday: appState.stats.savedToday,
        pendingContacts: appState.contacts.filter(c => c.pending),
        savedContacts: appState.contacts.filter(c => !c.pending),
        mode: 'PRODUCTION'
    })}\n\n`);
});

app.get('/', (req, res) => {
    const idx = path.join(__dirname, '../frontend/index.html');
    if (fs.existsSync(idx)) res.sendFile(idx);
    else res.send('<html><body style="background:#0a0a0a;color:#fff;text-align:center;padding:40px"><h1 style="color:#25d366">🚀 ContatoSync</h1><p>Online</p></body></html>');
});

app.use((err, req, res, next) => {
    log(`Erro: ${err.message}`, 'error');
    res.status(500).json({ error: 'Erro interno' });
});

app.get('*', (req, res) => res.status(404).send('Not found'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    log(`🚀 ContatoSync iniciado na porta ${PORT}`);
    log('✅ Logger Baileys com .child() configurado');
    log('✅ Pronto para conectar WhatsApp');
});

process.on('SIGTERM', () => { log('Encerrando...'); process.exit(0); });
process.on('SIGINT', () => { log('Encerrando...'); process.exit(0); });
