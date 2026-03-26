'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const QRCode = require('qrcode');
const axios = require('axios');

process.on('uncaughtException', (err) => { console.error('❌ uncaughtException:', err); });
process.on('unhandledRejection', (reason) => { console.error('❌ unhandledRejection:', reason); });

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
    whatsapp: { sessionPath: './whatsapp_session' },
    dataFile: './data/contatosync.json'
};

// =============================================
// PERSISTENCIA EM DISCO
// =============================================
function ensureDataDir() {
    const dir = path.dirname(config.dataFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadPersistedData() {
    try {
        ensureDataDir();
        if (fs.existsSync(config.dataFile)) {
            const raw = fs.readFileSync(config.dataFile, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error('Erro ao carregar dados persistidos:', e.message);
    }
    return null;
}

function savePersistedData() {
    try {
        ensureDataDir();
        const data = {
            sequencer: appState.sequencer,
            contacts: appState.contacts,
            googleTokens: appState.google.accessToken ? {
                accessToken: appState.google.accessToken,
                refreshToken: appState.google.refreshToken
            } : null,
            savedAt: new Date().toISOString()
        };
        fs.writeFileSync(config.dataFile, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Erro ao salvar dados:', e.message);
    }
}

// Salva a cada 30 segundos automaticamente
setInterval(savePersistedData, 30000);

// =============================================
// ESTADO DA APLICACAO
// =============================================
const persisted = loadPersistedData();

let appState = {
    whatsapp: { connected: false, qr: null, phone: null, lastActivity: null, autoSave: true, socket: null },
    google: { connected: false, accessToken: null, refreshToken: null, profile: null, oauth2Client: null },
    icloud: { connected: false, appleId: null, lastSync: null },
    sequencer: persisted?.sequencer || { prefix: 'Contato Zap', current: 1 },
    contacts: persisted?.contacts || [],
    logs: [],
    stats: {
        total: persisted?.contacts?.length || 0,
        pending: persisted?.contacts?.filter(c => c.pending)?.length || 0,
        savedToday: 0
    },
    sync: { running: false, progress: 0, total: 0, saved: 0, skipped: 0, errors: 0, lastRun: null }
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

let debugLogs = [];
function debugLog(msg) {
    const entry = '[' + new Date().toISOString() + '] ' + msg;
    console.log(entry);
    debugLogs.push(entry);
    if (debugLogs.length > 200) debugLogs.shift();
}

function jidToPhone(jid) {
    if (!jid) return null;
    const raw = jid.split('@')[0].split(':')[0];
    if (/^\d{7,15}$/.test(raw)) return '+' + raw;
    return null;
}

const delay = (ms) => new Promise(res => setTimeout(res, ms));

function buildContactName(pushName) {
    const base = appState.sequencer.prefix + ' ' + appState.sequencer.current;
    if (pushName && pushName.trim()) {
        const firstName = pushName.trim().split(' ')[0];
        return base + ' - ' + firstName;
    }
    return base;
}

// =============================================
// GOOGLE OAUTH - com persistencia de tokens
// =============================================
function initGoogleOAuth() {
    const oauth2Client = new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, config.google.redirectUri);
    appState.google.oauth2Client = oauth2Client;
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent', // IMPORTANTE: forca retornar refresh_token sempre
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

    // Salvar tokens no disco imediatamente
    savePersistedData();

    const oauth2 = google.oauth2('v2');
    const userInfo = await oauth2.userinfo.get({ auth: appState.google.oauth2Client });
    appState.google.profile = { email: userInfo.data.email, name: userInfo.data.name, picture: userInfo.data.picture };
    appState.google.connected = true;
    log('Google conectado: ' + appState.google.profile.email);
    broadcast('agenda-update', { google: true, profile: appState.google.profile });
    return { ok: true, profile: appState.google.profile };
}

function restoreGoogleTokens() {
    if (!persisted?.googleTokens) return;
    try {
        const oauth2Client = new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, config.google.redirectUri);
        oauth2Client.setCredentials({
            access_token: persisted.googleTokens.accessToken,
            refresh_token: persisted.googleTokens.refreshToken
        });
        // Quando o access token expirar, o oauth2Client usa o refresh token automaticamente
        oauth2Client.on('tokens', (tokens) => {
            if (tokens.access_token) {
                appState.google.accessToken = tokens.access_token;
                savePersistedData();
                debugLog('Google token renovado automaticamente');
            }
        });
        appState.google.oauth2Client = oauth2Client;
        appState.google.accessToken = persisted.googleTokens.accessToken;
        appState.google.refreshToken = persisted.googleTokens.refreshToken;
        appState.google.connected = true;
        debugLog('Tokens Google restaurados do disco');
    } catch (e) {
        debugLog('Erro ao restaurar tokens Google: ' + e.message);
    }
}

async function saveContactToGoogle(phone, name) {
    if (!appState.google.connected || !appState.google.oauth2Client) throw new Error('Google não conectado');
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

async function isPhoneInGoogle(phone) {
    if (!appState.google.connected || !appState.google.oauth2Client) return false;
    try {
        const peopleApi = google.people({ version: 'v1', auth: appState.google.oauth2Client });
        const res = await peopleApi.people.searchContacts({
            query: phone.replace('+', ''),
            readMask: 'phoneNumbers',
            pageSize: 1
        });
        return (res.data.results || []).length > 0;
    } catch (e) {
        return false;
    }
}

// =============================================
// SYNC HISTORICO
// =============================================
async function syncHistory() {
    if (appState.sync.running) return { ok: false, message: 'Sincronização já em andamento' };
    if (!appState.whatsapp.connected || !appState.whatsapp.socket) return { ok: false, message: 'WhatsApp não conectado' };
    if (!appState.google.connected && !appState.icloud.connected) return { ok: false, message: 'Nenhuma agenda conectada' };

    appState.sync.running = true;
    appState.sync.progress = 0;
    appState.sync.saved = 0;
    appState.sync.skipped = 0;
    appState.sync.errors = 0;
    broadcast('sync-update', { ...appState.sync, status: 'iniciando' });

    try {
        const sock = appState.whatsapp.socket;

        // Estrategia: usar chats do store interno do Baileys
        // O Baileys popula o store via evento 'chats.set' na conexao
        let chats = [];

        // Tentar todas as formas possiveis de acessar os chats
        try {
            if (sock.store) {
                const s = sock.store;
                if (s.chats && typeof s.chats.all === 'function') chats = s.chats.all();
                else if (s.chats && s.chats.array) chats = s.chats.array;
                else if (s.chats) chats = Array.from(Object.values(s.chats));
            }
        } catch (e) { debugLog('store err: ' + e.message); }

        // Fallback: usar o chatsSaved que populamos via evento chats.set
        if (chats.length === 0 && appState.whatsapp.chatsCache) {
            chats = appState.whatsapp.chatsCache;
            debugLog('Usando cache de chats: ' + chats.length);
        }

        debugLog('Chats encontrados para sync: ' + chats.length);

        const individualChats = chats.filter(c => {
            const id = c.id || c.jid || '';
            return !id.endsWith('@g.us') && !id.endsWith('@broadcast') && id.includes('@');
        });

        debugLog('Chats individuais: ' + individualChats.length);
        appState.sync.total = individualChats.length;
        broadcast('sync-update', { ...appState.sync, status: 'processando', total: individualChats.length });

        if (individualChats.length === 0) {
            appState.sync.running = false;
            broadcast('sync-update', { ...appState.sync, status: 'concluido' });
            return { ok: true, saved: 0, skipped: 0, errors: 0, total: 0, message: 'Nenhum chat encontrado. O WhatsApp pode precisar de alguns minutos para carregar o histórico após a conexão.' };
        }

        const BATCH_SIZE = 5;
        const BATCH_DELAY = 3000;

        for (let i = 0; i < individualChats.length; i += BATCH_SIZE) {
            const batch = individualChats.slice(i, i + BATCH_SIZE);

            for (const chat of batch) {
                const jid = chat.id || chat.jid || '';
                const phone = jidToPhone(jid);
                if (!phone) { appState.sync.skipped++; continue; }

                const jaNoSistema = appState.contacts.find(c => c.phone === phone);
                if (jaNoSistema) { appState.sync.skipped++; continue; }

                const jaNoGoogle = await isPhoneInGoogle(phone);
                if (jaNoGoogle) {
                    appState.sync.skipped++;
                    appState.contacts.push({
                        phone, name: chat.name || phone, pending: false,
                        hasRealPhone: true, savedToAgenda: true,
                        detected: new Date().toISOString(), savedAt: new Date().toISOString(),
                        id: 'contact_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                        source: 'sync-existing'
                    });
                    continue;
                }

                const name = buildContactName(chat.name || null);
                appState.sequencer.current++;

                let savedAgenda = false;
                let erroAgenda = null;
                if (appState.google.connected) {
                    try { await saveContactToGoogle(phone, name); savedAgenda = true; }
                    catch (e) { erroAgenda = e.message; appState.sync.errors++; }
                }

                const contact = {
                    phone, name, pending: false, hasRealPhone: true,
                    savedToAgenda: savedAgenda, erroAgenda: erroAgenda || null,
                    detected: new Date().toISOString(), savedAt: new Date().toISOString(),
                    id: 'contact_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                    source: 'sync'
                };

                appState.contacts.push(contact);
                appState.stats.total++;
                appState.stats.savedToday++;
                if (savedAgenda) appState.sync.saved++;
                broadcast('contact', contact);
            }

            appState.sync.progress = Math.min(i + BATCH_SIZE, individualChats.length);
            broadcast('sync-update', { ...appState.sync, status: 'processando' });
            if (i + BATCH_SIZE < individualChats.length) await delay(BATCH_DELAY);
        }

        savePersistedData();
        appState.sync.running = false;
        appState.sync.lastRun = new Date().toISOString();
        broadcast('sync-update', { ...appState.sync, status: 'concluido' });
        return { ok: true, saved: appState.sync.saved, skipped: appState.sync.skipped, errors: appState.sync.errors, total: appState.sync.total };

    } catch (e) {
        appState.sync.running = false;
        broadcast('sync-update', { ...appState.sync, status: 'erro', message: e.message });
        return { ok: false, message: e.message };
    }
}

// =============================================
// WHATSAPP
// =============================================
const CLEAR_WHATSAPP_SESSION_ON_START = false; // NAO limpar sessao ao iniciar
let sessionClearedOnce = false;

async function initWhatsApp() {
    try {
        const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = await loadBaileys();

        if (!fs.existsSync(config.whatsapp.sessionPath)) fs.mkdirSync(config.whatsapp.sessionPath, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(config.whatsapp.sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version, auth: state, printQRInTerminal: false,
            logger: makeSilentLogger(),
            browser: ['ContatoSync', 'Chrome', '120.0.0']
        });

        appState.whatsapp.socket = sock;
        appState.whatsapp.chatsCache = [];

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
                if (shouldReconnect) setTimeout(() => initWhatsApp(), 3000);
                else log('🚪 Sessão encerrada com logout.');
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

        // Capturar chats ao conectar — popula o cache para o sync historico
        sock.ev.on('chats.set', ({ chats }) => {
            debugLog('chats.set recebido: ' + chats.length + ' chats');
            appState.whatsapp.chatsCache = chats || [];
        });

        sock.ev.on('chats.upsert', (chats) => {
            if (!appState.whatsapp.chatsCache) appState.whatsapp.chatsCache = [];
            chats.forEach(c => {
                const exists = appState.whatsapp.chatsCache.find(x => x.id === c.id);
                if (!exists) appState.whatsapp.chatsCache.push(c);
            });
            debugLog('chats.upsert: total cache = ' + appState.whatsapp.chatsCache.length);
        });

        sock.ev.on('messages.upsert', async ({ messages }) => {
            for (const msg of messages) {
                if (!msg.key?.remoteJid || msg.key.fromMe) continue;
                const jid = msg.key.remoteJid;
                if (jid.endsWith('@g.us') || jid.endsWith('@broadcast')) continue;

                let phone = null;
                if (msg.key.senderPn) { phone = jidToPhone(msg.key.senderPn); }
                if (!phone) { phone = jidToPhone(jid); }
                if (!phone && msg.key.senderLid) { phone = jidToPhone(msg.key.senderLid); }
                if (!phone) { debugLog('Nao foi possivel extrair numero de: ' + jid); continue; }

                const jaExiste = appState.contacts.find(c => c.phone === phone);
                if (jaExiste) { debugLog('Contato ja existe: ' + phone); continue; }

                const name = buildContactName(msg.pushName);
                appState.sequencer.current++;

                let savedAgenda = false;
                let erroAgenda = null;
                if (appState.google.connected) {
                    try { await saveContactToGoogle(phone, name); savedAgenda = true; }
                    catch (e) { erroAgenda = e.message; debugLog('Erro Google: ' + e.message); }
                }

                const contact = {
                    phone, name, pushName: msg.pushName || null,
                    pending: false, hasRealPhone: true,
                    savedToAgenda: savedAgenda, erroAgenda: erroAgenda || null,
                    detected: new Date().toISOString(), savedAt: new Date().toISOString(),
                    id: 'contact_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                    source: 'whatsapp'
                };

                appState.contacts.push(contact);
                appState.stats.total++;
                appState.stats.savedToday++;
                savePersistedData(); // salvar no disco imediatamente
                log('Novo contato: ' + name + ' (' + phone + ')' + (savedAgenda ? ' ✅' : ' ⚠️'));
                broadcast('contact', contact);
            }
        });

        return sock;
    } catch (error) {
        log('Erro ao inicializar WhatsApp: ' + error.message, 'error');
        throw error;
    }
}

async function connectICloud(appleId, appPassword) {
    const response = await axios({
        method: 'PROPFIND',
        url: 'https://contacts.icloud.com/',
        auth: { username: appleId, password: appPassword },
        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Depth': '0' },
        data: '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/></D:prop></D:propfind>',
        timeout: 15000,
        validateStatus: (s) => s < 500
    });
    if (response.status === 401) throw new Error('Credenciais inválidas. Verifique seu Apple ID e a App-Specific Password.');
    if (response.status === 207 || response.status === 200) {
        appState.icloud.connected = true;
        appState.icloud.appleId = appleId;
        appState.icloud.lastSync = new Date().toISOString();
        log('iCloud conectado: ' + appleId);
        broadcast('agenda-update', { icloud: true });
        return { ok: true, message: 'iCloud conectado com sucesso' };
    }
    throw new Error('Resposta inesperada do iCloud: ' + response.status);
}

// =============================================
// ROTAS
// =============================================
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/health', (req, res) => { res.json({ status: 'ok', uptime: process.uptime(), mode: 'PRODUCTION' }); });
app.get('/debug/logs', (req, res) => { res.json({ logs: debugLogs, chatsCache: appState.whatsapp.chatsCache?.length || 0 }); });

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

app.get('/sync/status', (req, res) => { res.json(appState.sync); });
app.post('/sync/history', async (req, res) => { const result = await syncHistory(); res.json(result); });

app.post('/whatsapp/connect', async (req, res) => {
    try {
        if (appState.whatsapp.connected) return res.json({ ok: true, message: 'Já conectado', phone: appState.whatsapp.phone });
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
        if (fs.existsSync(config.whatsapp.sessionPath)) fs.rmSync(config.whatsapp.sessionPath, { recursive: true, force: true });
        broadcast('disconnected', { status: 'disconnected' });
        res.json({ ok: true });
    } catch (e) { res.json({ ok: true }); }
});

app.get('/google/status', (req, res) => { res.json({ connected: appState.google.connected, profile: appState.google.profile }); });

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
    } catch (e) { res.send('<h2>Erro</h2><p>' + e.message + '</p>'); }
});

app.post('/auth/google/disconnect', (req, res) => {
    appState.google.connected = false;
    appState.google.profile = null;
    appState.google.accessToken = null;
    appState.google.refreshToken = null;
    appState.google.oauth2Client = null;
    savePersistedData();
    broadcast('agenda-update', { google: false });
    res.json({ ok: true });
});

app.get('/icloud/status', (req, res) => { res.json({ connected: appState.icloud.connected, appleId: appState.icloud.appleId }); });

app.post('/auth/icloud', async (req, res) => {
    try {
        const { appleId, appPassword } = req.body;
        if (!appleId || !appPassword) return res.json({ ok: false, error: 'Dados obrigatórios' });
        const result = await connectICloud(appleId, appPassword);
        res.json(result);
    } catch (e) {
        if (e.response?.status === 401 || e.message.includes('Credenciais')) return res.status(401).json({ ok: false, error: e.message });
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
    savePersistedData();
    res.json(appState.sequencer);
});

app.post('/contacts/save', async (req, res) => {
    const { contactId } = req.body;
    const contact = appState.contacts.find(c => c.id === contactId || c.phone === contactId);
    if (!contact) return res.json({ ok: false, message: 'Contato não encontrado' });
    if (!contact.pending) return res.json({ ok: false, message: 'Já salvo' });
    const name = buildContactName(contact.pushName || null);
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
    savePersistedData();
    res.json({ ok: true, contact });
});

app.post('/contacts/save-all', async (req, res) => {
    const pending = appState.contacts.filter(c => c.pending);
    if (!pending.length) return res.json({ ok: false, message: 'Nenhum pendente' });
    let saved = 0;
    for (const c of pending) {
        const name = buildContactName(c.pushName || null);
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
    savePersistedData();
    res.json({ ok: true, saved, message: saved + ' contatos salvos' });
});

// Rota para limpar contatos (util para testes)
app.post('/contacts/clear', (req, res) => {
    appState.contacts = [];
    appState.stats.total = 0;
    appState.stats.pending = 0;
    appState.stats.savedToday = 0;
    savePersistedData();
    res.json({ ok: true });
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
    // Restaurar tokens do Google do disco
    restoreGoogleTokens();
    if (appState.google.connected) {
        log('✅ Google Contacts restaurado do disco');
        broadcast('agenda-update', { google: true });
    }
    // Iniciar WhatsApp
    initWhatsApp().catch(e => log('Erro ao iniciar WhatsApp: ' + e.message, 'error'));
});

process.on('SIGTERM', () => { savePersistedData(); log('Encerrando...'); process.exit(0); });
process.on('SIGINT', () => { savePersistedData(); log('Encerrando...'); process.exit(0); });
