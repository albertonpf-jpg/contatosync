'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const QRCode = require('qrcode');
const axios = require('axios');

process.on('uncaughtException', (err) => {
    console.error('❌ uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('❌ unhandledRejection:', reason);
});

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

const CLEAR_WHATSAPP_SESSION_ON_START = true;
let sessionClearedOnce = false;

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

function makeSilentLogger() {
    const noop = () => {};
    return { level: 'silent', trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop, child: () => makeSilentLogger() };
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
    sseClients.forEach(client => { try { client.write(message); } catch (e) {} });
}

// Buffer de logs de debug
let debugLogs = [];
function debugLog(msg) {
    const entry = '[' + new Date().toISOString() + '] ' + msg;
    console.log(entry);
    debugLogs.push(entry);
    if (debugLogs.length > 200) debugLogs.shift();
}

// Extrai numero real de um JID @s.whatsapp.net
function jidToPhone(jid) {
    if (!jid) return null;
    const raw = jid.split('@')[0].split(':')[0];
    if (/^\d{7,15}$/.test(raw)) return '+' + raw;
    return null;
}

async function saveContactToGoogle(phone, name) {
    if (!appState.google.connected || !appState.google.oauth2Client) {
        throw new Error('Google não conectado');
    }
    const peopleApi = google.people({ version: 'v1', auth: appState.google.oauth2Client });
    await peopleApi.people.createContact({
        requestBody: {
            names: [{ givenName: name }],
            phoneNumbers: [{ value: phone, type: 'mobile' }]
        }
    });
    debugLog('Salvo no Google Contacts: ' + name + ' (' + phone + ')');
    return true;
}

async function initWhatsApp() {
    try {
        const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = await loadBaileys();

        if (!fs.existsSync(config.whatsapp.sessionPath)) {
            fs.mkdirSync(config.whatsapp.sessionPath, { recursive: true });
        }

        if (CLEAR_WHATSAPP_SESSION_ON_START && !sessionClearedOnce) {
            if (fs.existsSync(config.whatsapp.sessionPath)) {
                fs.rmSync(config.whatsapp.sessionPath, { recursive: true, force: true });
                log('🧹 Sessão antiga removida');
            }
            fs.mkdirSync(config.whatsapp.sessionPath, { recursive: true });
            sessionClearedOnce = true;
        }

        const { state, saveCreds } = await useMultiFileAuthState(config.whatsapp.sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version, auth: state, printQRInTerminal: false,
            logger: makeSilentLogger(),
            browser: ['ContatoSync', 'Chrome', '120.0.0']
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
                } catch (e) { log('Erro QR: ' + e.message, 'error'); }
            }
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                appState.whatsapp.connected = false;
                appState.whatsapp.phone = null;
                appState.whatsapp.qr = null;
                broadcast('disconnected', { status: 'disconnected', statusCode });
                if (shouldReconnect) {
                    setTimeout(() => initWhatsApp(), 3000);
                } else {
                    log('🚪 Sessão encerrada com logout.');
                }
            } else if (connection === 'open') {
                appState.whatsapp.connected = true;
                appState.whatsapp.qr = null;
                appState.whatsapp.phone = sock.user?.id || 'Conectado';
                appState.whatsapp.lastActivity = new Date().toISOString();
                log('WhatsApp conectado: ' + appState.whatsapp.phone);
                broadcast('connected', { status: 'connected', phone: appState.whatsapp.phone });
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('messages.upsert', async ({ messages }) => {
            for (const msg of messages) {
                if (!msg.key?.remoteJid || msg.key.fromMe) continue;

                const jid = msg.key.remoteJid;
                if (jid.endsWith('@g.us') || jid.endsWith('@broadcast')) continue;

                // CORRECAO: usar senderPn que tem o numero real mesmo para LIDs
                let phone = null;

                // 1) senderPn na key — campo mais confiavel para LIDs
                if (msg.key.senderPn) {
                    phone = jidToPhone(msg.key.senderPn);
                    if (phone) debugLog('Numero via senderPn: ' + phone);
                }

                // 2) JID direto se for @s.whatsapp.net
                if (!phone) {
                    phone = jidToPhone(jid);
                    if (phone) debugLog('Numero via JID: ' + phone);
                }

                // 3) senderLid como ultimo recurso numerico
                if (!phone && msg.key.senderLid) {
                    phone = jidToPhone(msg.key.senderLid);
                    if (phone) debugLog('Numero via senderLid: ' + phone);
                }

                if (!phone) {
                    debugLog('Nao foi possivel extrair numero de: ' + jid);
                    continue;
                }

                debugLog('Numero final: ' + phone + ' | nome: ' + (msg.pushName || 'null'));

                // Verificar se ja existe
                const jaExiste = appState.contacts.find(c => c.phone === phone);
                if (jaExiste) { debugLog('Contato ja existe: ' + phone); continue; }

                // Gerar nome sequencial
                const name = appState.sequencer.prefix + ' ' + appState.sequencer.current;
                appState.sequencer.current++;

                // Salvar na agenda (Google e/ou iCloud)
                let savedAgenda = false;
                let erroAgenda = null;

                if (appState.google.connected) {
                    try {
                        await saveContactToGoogle(phone, name);
                        savedAgenda = true;
                        debugLog('Salvo no Google: ' + name);
                    } catch (e) {
                        erroAgenda = e.message;
                        debugLog('Erro Google: ' + e.message);
                    }
                }

                if (appState.icloud.connected) {
                    // iCloud save aqui quando implementado
                }

                if (!appState.google.connected && !appState.icloud.connected) {
                    debugLog('ATENCAO: Nenhuma agenda conectada! Contato detectado mas nao salvo.');
                }

                // Registrar no sistema
                const contact = {
                    phone,
                    name,
                    pending: false,
                    hasRealPhone: true,
                    savedToAgenda: savedAgenda,
                    erroAgenda: erroAgenda || null,
                    detected: new Date().toISOString(),
                    savedAt: new Date().toISOString(),
                    id: 'contact_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                    source: 'whatsapp'
                };

                appState.contacts.push(contact);
                appState.stats.total++;
                appState.stats.savedToday++;
                log('Novo contato salvo: ' + name + ' (' + phone + ')' + (savedAgenda ? ' ✅ Google' : ' ⚠️ Sem agenda'));
                broadcast('contact', contact);
            }
        });

        return sock;
    } catch (error) {
        log('Erro ao inicializar WhatsApp: ' + error.message, 'error');
        throw error;
    }
}

function initGoogleOAuth() {
    const oauth2Client = new google.auth.OAuth2(
        config.google.clientId, config.google.clientSecret, config.google.redirectUri
    );
    appState.google.oauth2Client = oauth2Client;
    // CORRECAO: scope contacts (sem readonly) para poder criar contatos
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/contacts',
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
    log('Google conectado: ' + appState.google.profile.email);
    broadcast('agenda-update', { google: true, profile: appState.google.profile });
    return { ok: true, profile: appState.google.profile };
}

async function connectICloud(appleId, appPassword) {
    // CORRECAO: XML valido e URL correta do iCloud CardDAV
    const response = await axios({
        method: 'PROPFIND',
        url: 'https://contacts.icloud.com/',
        auth: { username: appleId, password: appPassword },
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Depth': '0'
        },
        data: '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/></D:prop></D:propfind>',
        timeout: 15000,
        validateStatus: (s) => s < 500
    });
    if (response.status === 207 || response.status === 200 || response.status === 401) {
        if (response.status === 401) throw new Error('Credenciais inválidas. Verifique seu Apple ID e a App-Specific Password.');
        appState.icloud.connected = true;
        appState.icloud.appleId = appleId;
        appState.icloud.lastSync = new Date().toISOString();
        log('iCloud conectado: ' + appleId);
        broadcast('agenda-update', { icloud: true });
        return { ok: true, message: 'iCloud conectado com sucesso' };
    }
    throw new Error('Resposta inesperada do iCloud: ' + response.status);
}

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), mode: 'PRODUCTION' });
});

app.get('/debug/logs', (req, res) => {
    res.json({ logs: debugLogs });
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
        if (appState.whatsapp.connected) {
            return res.json({ ok: true, message: 'Já conectado', phone: appState.whatsapp.phone });
        }
        log('Iniciando WhatsApp...');
        await initWhatsApp();
        res.json({ ok: true, message: 'Conectando... aguarde o QR Code' });
    } catch (error) {
        log('Erro connect: ' + error.message, 'error');
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
    catch (e) { res.status(500).send('<h1>Erro OAuth</h1>'); }
});

app.get('/auth/google/callback', async (req, res) => {
    try {
        const { code, error } = req.query;
        if (error) throw new Error(error);
        if (!code) throw new Error('Código não encontrado');
        const result = await handleGoogleCallback(code);
        res.send('<h2>✅ Google Conectado!</h2><p>Bem-vindo, <b>' + result.profile.name + '</b></p><p>' + result.profile.email + '</p><script>setTimeout(()=>window.close(),2000)</script>');
    } catch (e) {
        res.send('<h2>Erro</h2><p>' + e.message + '</p>');
    }
});

app.post('/auth/google/disconnect', (req, res) => {
    appState.google.connected = false;
    appState.google.profile = null;
    appState.google.accessToken = null;
    appState.google.oauth2Client = null;
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
        if (e.response?.status === 401 || e.message.includes('Credenciais')) {
            return res.status(401).json({ ok: false, error: e.message });
        }
        res.status(500).json({ ok: false, error: e.message });
    }
});

app.post('/auth/icloud/disconnect', (req, res) => {
    appState.icloud.connected = false;
    appState.icloud.appleId = null;
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

app.post('/contacts/save', async (req, res) => {
    const { contactId } = req.body;
    const contact = appState.contacts.find(c => c.id === contactId || c.phone === contactId);
    if (!contact) return res.json({ ok: false, message: 'Contato não encontrado' });
    if (!contact.pending) return res.json({ ok: false, message: 'Já salvo' });
    const name = appState.sequencer.prefix + ' ' + appState.sequencer.current;
    if (appState.google.connected) {
        try { await saveContactToGoogle(contact.phone, name); } catch (e) { debugLog('Erro Google: ' + e.message); }
    }
    contact.name = name;
    contact.pending = false;
    contact.savedAt = new Date().toISOString();
    contact.source = 'manual';
    appState.sequencer.current++;
    appState.stats.pending--;
    appState.stats.savedToday++;
    res.json({ ok: true, contact });
});

app.post('/contacts/save-all', async (req, res) => {
    const pending = appState.contacts.filter(c => c.pending);
    if (!pending.length) return res.json({ ok: false, message: 'Nenhum pendente' });
    let saved = 0;
    for (const c of pending) {
        const name = appState.sequencer.prefix + ' ' + appState.sequencer.current;
        if (appState.google.connected) {
            try { await saveContactToGoogle(c.phone, name); } catch (e) {}
        }
        c.name = name;
        c.pending = false;
        c.savedAt = new Date().toISOString();
        c.source = 'bulk';
        appState.sequencer.current++;
        saved++;
    }
    appState.stats.pending = 0;
    appState.stats.savedToday += saved;
    res.json({ ok: true, saved, message: saved + ' contatos salvos' });
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
    res.write('event: status\ndata: ' + JSON.stringify({
        status: appState.whatsapp.connected ? 'connected' : 'disconnected',
        googleConnected: appState.google.connected,
        icloudConnected: appState.icloud.connected,
        savedToday: appState.stats.savedToday,
        pendingContacts: appState.contacts.filter(c => c.pending),
        savedContacts: appState.contacts.filter(c => !c.pending),
        mode: 'PRODUCTION'
    }) + '\n\n');
});

app.get('/', (req, res) => {
    const idx = path.join(__dirname, '../frontend/index.html');
    if (fs.existsSync(idx)) res.sendFile(idx);
    else res.send('<h1>🚀 ContatoSync Online</h1>');
});

app.use((err, req, res, next) => {
    log('Erro: ' + err.message, 'error');
    res.status(500).json({ error: 'Erro interno' });
});

app.get('*', (req, res) => res.status(404).send('Not found'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    log('🚀 ContatoSync iniciado na porta ' + PORT);
    initWhatsApp().catch(e => log('Erro ao iniciar WhatsApp: ' + e.message, 'error'));
});

process.on('SIGTERM', () => { log('Encerrando...'); process.exit(0); });
process.on('SIGINT', () => { log('Encerrando...'); process.exit(0); });
