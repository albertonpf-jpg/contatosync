'use strict';

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║                           🚀 CONTATOSYNC BACKEND                           ║
// ║                        Backend REAL - Integrações Funcionais               ║
// ║             WhatsApp (Baileys) + Google OAuth + iCloud CardDAV             ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const { google } = require('googleapis');
const QRCode = require('qrcode');
const axios = require('axios');
const xml2js = require('xml2js');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const config = {
    google: {
        clientId: process.env.GOOGLE_CLIENT_ID || 'SEU_GOOGLE_CLIENT_ID',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'SEU_GOOGLE_CLIENT_SECRET',
        redirectUri: process.env.GOOGLE_REDIRECT_URI || 'https://contatosync.vercel.app/auth/google/callback'
    },
    whatsapp: {
        sessionPath: './whatsapp_session'
    }
};

let appState = {
    whatsapp: { connected: false, qr: null, phone: null, lastActivity: null, autoSave: true, socket: null },
    google: { connected: false, accessToken: null, refreshToken: null, profile: null, oauth2Client: null },
    icloud: { connected: false, appleId: null, lastSync: null, contacts: [] },
    sequencer: { prefix: 'Contato Zap', current: 1 },
    contacts: [],
    logs: [],
    stats: { total: 0, pending: 0, savedToday: 0 }
};

let sseClients = [];

function log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, message, type };
    console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
    appState.logs.unshift(logEntry);
    if (appState.logs.length > 100) appState.logs.pop();
    return logEntry;
}

function broadcast(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(client => {
        try { client.write(message); } catch (error) { console.log('Cliente SSE desconectado'); }
    });
}

async function initWhatsApp() {
    try {
        if (!fs.existsSync(config.whatsapp.sessionPath)) {
            fs.mkdirSync(config.whatsapp.sessionPath);
        }

        const { state, saveCreds } = await useMultiFileAuthState(config.whatsapp.sessionPath);

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: { level: 'silent', trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, fatal: () => {} }
        });

        appState.whatsapp.socket = sock;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                try {
                    const qrCodeUrl = await QRCode.toDataURL(qr);
                    appState.whatsapp.qr = qrCodeUrl;
                    log('QR Code gerado para WhatsApp');
                    broadcast('qr', { qr: qrCodeUrl, message: 'QR Code gerado! Escaneie com seu WhatsApp' });
                } catch (error) {
                    log(`Erro ao gerar QR Code: ${error.message}`, 'error');
                }
            }

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;

                log(`WhatsApp conexão fechada. Reconectando: ${shouldReconnect}`);
                appState.whatsapp.connected = false;
                appState.whatsapp.phone = null;
                appState.whatsapp.qr = null;
                broadcast('disconnected', { status: 'disconnected', reason: 'connection_closed' });

                if (shouldReconnect) {
                    setTimeout(() => initWhatsApp(), 3000);
                }
            } else if (connection === 'open') {
                appState.whatsapp.connected = true;
                appState.whatsapp.qr = null;
                appState.whatsapp.phone = sock.user?.id || 'WhatsApp Conectado';
                appState.whatsapp.lastActivity = new Date().toISOString();
                log(`WhatsApp conectado: ${appState.whatsapp.phone}`);
                broadcast('connected', { status: 'connected', phone: appState.whatsapp.phone, timestamp: appState.whatsapp.lastActivity });
            }
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('contacts.update', (contacts) => {
            contacts.forEach(contact => {
                if (contact.id && contact.name) {
                    addNewContact(contact.id.replace('@s.whatsapp.net', ''), contact.name);
                }
            });
        });

        sock.ev.on('messages.upsert', (messageUpdate) => {
            const messages = messageUpdate.messages;
            messages.forEach(message => {
                if (message.key && message.key.remoteJid && !message.key.fromMe) {
                    const phoneNumber = message.key.remoteJid.replace('@s.whatsapp.net', '');
                    const pushName = message.pushName || null;
                    addNewContact(phoneNumber, pushName);
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
    const existingContact = appState.contacts.find(c => c.phone === phoneNumber);
    if (existingContact) return;

    const contactData = {
        phone: phoneNumber,
        name: name,
        pending: !name,
        detected: new Date().toISOString(),
        id: `contact_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        source: 'whatsapp'
    };

    appState.contacts.push(contactData);
    appState.stats.total++;
    if (contactData.pending) appState.stats.pending++;
    log(`Novo contato detectado: ${phoneNumber} ${name ? `(${name})` : '(sem nome)'}`);
    broadcast('contact', contactData);
}

function initGoogleOAuth() {
    const oauth2Client = new google.auth.OAuth2(
        config.google.clientId,
        config.google.clientSecret,
        config.google.redirectUri
    );
    appState.google.oauth2Client = oauth2Client;
    const scopes = [
        'https://www.googleapis.com/auth/contacts.readonly',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email'
    ];
    return oauth2Client.generateAuthUrl({ access_type: 'offline', scope: scopes });
}

async function handleGoogleCallback(code) {
    try {
        const { tokens } = await appState.google.oauth2Client.getAccessToken(code);
        appState.google.oauth2Client.setCredentials(tokens);
        appState.google.accessToken = tokens.access_token;
        appState.google.refreshToken = tokens.refresh_token;
        const oauth2 = google.oauth2('v2');
        const userInfo = await oauth2.userinfo.get({ auth: appState.google.oauth2Client });
        appState.google.profile = { email: userInfo.data.email, name: userInfo.data.name, picture: userInfo.data.picture };
        appState.google.connected = true;
        log(`Google OAuth conectado: ${appState.google.profile.email}`);
        broadcast('agenda-update', { google: true, profile: appState.google.profile });
        return { ok: true, profile: appState.google.profile };
    } catch (error) {
        log(`Erro no Google OAuth: ${error.message}`, 'error');
        throw error;
    }
}

async function syncGoogleContacts() {
    if (!appState.google.connected) throw new Error('Google não está conectado');
    try {
        const people = google.people('v1');
        const response = await people.people.connections.list({
            auth: appState.google.oauth2Client,
            resourceName: 'people/me',
            personFields: 'names,emailAddresses,phoneNumbers'
        });
        const contacts = response.data.connections || [];
        contacts.forEach(contact => {
            const name = contact.names?.[0]?.displayName || 'Sem nome';
            const phone = contact.phoneNumbers?.[0]?.value || null;
            if (phone) {
                const cleanPhone = phone.replace(/\D/g, '');
                const existingContact = appState.contacts.find(c => c.phone.includes(cleanPhone));
                if (!existingContact) addNewContact(cleanPhone, name, 'google');
            }
        });
        log(`Sincronização Google: ${contacts.length} contatos processados`);
        return { ok: true, count: contacts.length };
    } catch (error) {
        log(`Erro ao sincronizar Google Contacts: ${error.message}`, 'error');
        throw error;
    }
}

async function connectICloud(appleId, appPassword) {
    try {
        const cardDavUrl = `https://${appleId}:${appPassword}@contacts.icloud.com/`;
        const response = await axios({
            method: 'PROPFIND',
            url: cardDavUrl,
            headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Depth': '0' },
            data: `<?xml version="1.0" encoding="utf-8" ?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/><D:resourcetype/></D:prop></D:propfind>`,
            timeout: 10000
        });
        if (response.status === 207) {
            appState.icloud.connected = true;
            appState.icloud.appleId = appleId;
            appState.icloud.lastSync = new Date().toISOString();
            log(`iCloud conectado: ${appleId}`);
            broadcast('agenda-update', { icloud: true });
            return { ok: true, message: 'iCloud conectado com sucesso' };
        } else {
            throw new Error('Credenciais inválidas');
        }
    } catch (error) {
        if (error.response && error.response.status === 401) throw new Error('Credenciais incorretas. Verifique Apple ID e senha de app');
        throw new Error(`Erro ao conectar iCloud: ${error.message}`);
    }
}

async function synciCloudContacts(appleId, appPassword) {
    try {
        const cardDavUrl = `https://${appleId}:${appPassword}@contacts.icloud.com/`;
        const response = await axios({
            method: 'REPORT',
            url: cardDavUrl,
            headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Depth': '1' },
            data: `<?xml version="1.0" encoding="utf-8" ?><C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><D:prop><D:getetag/><C:address-data/></D:prop></C:addressbook-query>`,
            timeout: 15000
        });
        if (response.status === 207) {
            const parser = new xml2js.Parser();
            const result = await parser.parseStringPromise(response.data);
            let contactCount = 0;
            if (result.multistatus && result.multistatus.response) {
                for (const responseItem of result.multistatus.response) {
                    if (responseItem.propstat && responseItem.propstat[0].prop && responseItem.propstat[0].prop[0]['address-data']) {
                        const vcard = responseItem.propstat[0].prop[0]['address-data'][0];
                        const contact = parseVCard(vcard);
                        if (contact.phone) {
                            const existingContact = appState.contacts.find(c => c.phone.includes(contact.phone.replace(/\D/g, '')));
                            if (!existingContact) { addNewContact(contact.phone, contact.name, 'icloud'); contactCount++; }
                        }
                    }
                }
            }
            log(`Sincronização iCloud: ${contactCount} contatos importados`);
            return { ok: true, count: contactCount };
        } else {
            throw new Error('Erro ao buscar contatos');
        }
    } catch (error) {
        log(`Erro ao sincronizar iCloud: ${error.message}`, 'error');
        throw error;
    }
}

function parseVCard(vcard) {
    const lines = vcard.split('\n');
    let name = null;
    let phone = null;
    lines.forEach(line => {
        if (line.startsWith('FN:')) name = line.substring(3).trim();
        if (line.startsWith('TEL:') || line.includes('TYPE=CELL') || line.includes('TYPE=MOBILE')) phone = line.split(':')[1]?.trim();
    });
    return { name, phone };
}

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime(), version: '2.0.0', mode: 'PRODUCTION', integrations: { whatsapp: 'REAL (Baileys)', google: 'REAL (OAuth)', icloud: 'REAL (CardDAV)' } });
});

app.get('/whatsapp/status', (req, res) => {
    res.json({ status: appState.whatsapp.connected ? 'connected' : 'disconnected', connected: appState.whatsapp.connected, phone: appState.whatsapp.phone, qr: appState.whatsapp.qr, lastActivity: appState.whatsapp.lastActivity, autoSave: appState.whatsapp.autoSave, savedToday: appState.stats.savedToday, pendingContacts: appState.contacts.filter(c => c.pending), savedContacts: appState.contacts.filter(c => !c.pending), integration: 'Baileys (WhatsApp Web API)' });
});

app.post('/whatsapp/connect', async (req, res) => {
    try {
        if (appState.whatsapp.connected) return res.json({ ok: true, message: 'WhatsApp já está conectado', phone: appState.whatsapp.phone });
        log('Iniciando conexão WhatsApp via Baileys...');
        await initWhatsApp();
        res.json({ ok: true, message: 'Conectando WhatsApp... QR Code será gerado em breve', instructions: 'Aguarde o QR Code aparecer e escaneie com seu WhatsApp' });
    } catch (error) {
        log(`Erro ao conectar WhatsApp: ${error.message}`, 'error');
        res.status(500).json({ ok: false, error: 'Erro ao conectar WhatsApp' });
    }
});

app.post('/whatsapp/disconnect', (req, res) => {
    try {
        if (appState.whatsapp.socket) appState.whatsapp.socket.logout();
        appState.whatsapp.connected = false;
        appState.whatsapp.qr = null;
        appState.whatsapp.phone = null;
        appState.whatsapp.socket = null;
        if (fs.existsSync(config.whatsapp.sessionPath)) fs.rmSync(config.whatsapp.sessionPath, { recursive: true, force: true });
        log('WhatsApp desconectado');
        broadcast('disconnected', { status: 'disconnected' });
        res.json({ ok: true });
    } catch (error) {
        log(`Erro ao desconectar WhatsApp: ${error.message}`, 'error');
        res.json({ ok: true });
    }
});

app.get('/google/status', (req, res) => { res.json({ connected: appState.google.connected, profile: appState.google.profile }); });

app.get('/auth/google', (req, res) => {
    try {
        const authUrl = initGoogleOAuth();
        res.redirect(authUrl);
    } catch (error) {
        log(`Erro ao gerar URL Google OAuth: ${error.message}`, 'error');
        res.status(500).send('<html><body style="font-family:Arial;text-align:center;padding:50px;"><h1>Erro de Configuração</h1><p>Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.</p><button onclick="window.close()">Fechar</button></body></html>');
    }
});

app.get('/auth/google/callback', async (req, res) => {
    try {
        const { code, error } = req.query;
        if (error) throw new Error(`Erro OAuth: ${error}`);
        if (!code) throw new Error('Código de autorização não encontrado');
        const result = await handleGoogleCallback(code);
        res.send(`<html><head><title>Google OAuth - ContatoSync</title></head><body style="font-family:Arial;text-align:center;padding:50px;background:#0a0a0a;color:white;"><h1 style="color:#25d366;">✅ Google Conectado!</h1><p>Bem-vindo, <strong>${result.profile.name}</strong></p><p>Email: ${result.profile.email}</p><p style="color:#25d366;">Você pode fechar esta janela.</p><script>setTimeout(() => { window.close(); }, 3000);</script></body></html>`);
    } catch (error) {
        log(`Erro no callback Google OAuth: ${error.message}`, 'error');
        res.send(`<html><body style="font-family:Arial;text-align:center;padding:50px;"><h1>Erro na Autenticação</h1><p>${error.message}</p><button onclick="window.close()">Fechar</button></body></html>`);
    }
});

app.post('/google/sync', async (req, res) => {
    try {
        if (!appState.google.connected) return res.json({ ok: false, error: 'Google não está conectado' });
        const result = await syncGoogleContacts();
        res.json(result);
    } catch (error) {
        log(`Erro ao sincronizar Google Contacts: ${error.message}`, 'error');
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.post('/auth/google/disconnect', (req, res) => {
    appState.google.connected = false;
    appState.google.profile = null;
    appState.google.accessToken = null;
    appState.google.refreshToken = null;
    appState.google.oauth2Client = null;
    log('Google OAuth desconectado');
    broadcast('agenda-update', { google: false });
    res.json({ ok: true });
});

app.get('/icloud/status', (req, res) => { res.json({ connected: appState.icloud.connected, appleId: appState.icloud.appleId, lastSync: appState.icloud.lastSync }); });

app.post('/auth/icloud', async (req, res) => {
    try {
        const { appleId, appPassword } = req.body;
        if (!appleId || !appPassword) return res.json({ ok: false, error: 'Apple ID e senha de app são obrigatórios' });
        if (!appleId.includes('@')) return res.json({ ok: false, error: 'Apple ID deve ser um email válido' });
        if (appPassword.length < 8) return res.json({ ok: false, error: 'Senha de app deve ter pelo menos 8 caracteres' });
        const result = await connectICloud(appleId, appPassword);
        res.json(result);
    } catch (error) {
        log(`Erro ao conectar iCloud: ${error.message}`, 'error');
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.post('/icloud/sync', async (req, res) => {
    try {
        if (!appState.icloud.connected) return res.json({ ok: false, error: 'iCloud não está conectado' });
        const result = await synciCloudContacts(appState.icloud.appleId, req.body.appPassword);
        res.json(result);
    } catch (error) {
        log(`Erro ao sincronizar iCloud: ${error.message}`, 'error');
        res.status(500).json({ ok: false, error: error.message });
    }
});

app.post('/auth/icloud/disconnect', (req, res) => {
    appState.icloud.connected = false;
    appState.icloud.appleId = null;
    appState.icloud.lastSync = null;
    log('iCloud desconectado');
    broadcast('agenda-update', { icloud: false });
    res.json({ ok: true });
});

app.get('/sequencer', (req, res) => { res.json(appState.sequencer); });

app.put('/sequencer', (req, res) => {
    const { prefix, current } = req.body;
    if (prefix) appState.sequencer.prefix = prefix;
    if (current && !isNaN(current)) appState.sequencer.current = parseInt(current);
    log(`Sequenciador atualizado: ${appState.sequencer.prefix} #${appState.sequencer.current}`);
    res.json(appState.sequencer);
});

app.post('/contacts/save', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.json({ ok: false, message: 'Telefone é obrigatório' });
        const contact = appState.contacts.find(c => c.phone === phone);
        if (!contact) return res.json({ ok: false, message: 'Contato não encontrado' });
        if (!contact.pending) return res.json({ ok: false, message: 'Contato já foi salvo' });
        const name = `${appState.sequencer.prefix} ${appState.sequencer.current}`;
        contact.name = name;
        contact.pending = false;
        contact.savedAt = new Date().toISOString();
        contact.source = 'manual';
        appState.sequencer.current++;
        appState.stats.pending--;
        appState.stats.savedToday++;
        log(`Contato salvo: ${name} - ${phone}`);
        res.json({ ok: true, contact: contact });
    } catch (error) {
        log(`Erro ao salvar contato: ${error.message}`, 'error');
        res.status(500).json({ ok: false, error: 'Erro interno' });
    }
});

app.post('/contacts/save-all', async (req, res) => {
    try {
        const pendingContacts = appState.contacts.filter(c => c.pending);
        if (pendingContacts.length === 0) return res.json({ ok: false, message: 'Nenhum contato pendente para salvar' });
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
        res.json({ ok: true, saved: saved, message: `${saved} contatos salvos com sucesso` });
    } catch (error) {
        log(`Erro ao salvar contatos em lote: ${error.message}`, 'error');
        res.status(500).json({ ok: false, error: 'Erro interno' });
    }
});

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    sseClients.push(res);
    log('Cliente SSE conectado');
    req.on('close', () => {
        const index = sseClients.indexOf(res);
        if (index !== -1) { sseClients.splice(index, 1); log('Cliente SSE desconectado'); }
    });
    res.write(`event: status\ndata: ${JSON.stringify({ status: appState.whatsapp.connected ? 'connected' : 'disconnected', googleConnected: appState.google.connected, icloudConnected: appState.icloud.connected, savedToday: appState.stats.savedToday, pendingContacts: appState.contacts.filter(c => c.pending), savedContacts: appState.contacts.filter(c => !c.pending), mode: 'PRODUCTION' })}\n\n`);
});

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, '../frontend/index.html');
    res.sendFile(indexPath, (err) => {
        if (err) res.send('<html><head><title>ContatoSync</title></head><body style="font-family:sans-serif;background:#0a0a0a;color:#efefef;text-align:center;padding:40px"><h1 style="color:#25d366">🚀 ContatoSync</h1><p>Backend Online - MODO PRODUÇÃO</p><a href="/health" style="color:#25d366">Verificar Saúde</a></body></html>');
    });
});

app.use((err, req, res, next) => {
    log(`Erro não tratado: ${err.message}`, 'error');
    res.status(500).json({ error: 'Erro interno do servidor', timestamp: new Date().toISOString() });
});

app.get('*', (req, res) => {
    res.status(404).send('<html><body style="font-family:Arial;padding:40px;background:#0a0a0a;color:white;text-align:center;"><h1 style="color:#25d366;">🚀 ContatoSync</h1><h2>404 - Página não encontrada</h2><p><a href="/" style="color:#25d366;">← Voltar ao início</a></p></body></html>');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    log(`🚀 ContatoSync Backend PRODUÇÃO iniciado na porta ${PORT}`);
    log(`📍 Acesse: http://localhost:${PORT}`);
    log('✅ WhatsApp: Baileys (API Real)');
    log('✅ Google OAuth: API Real com credenciais');
    log('✅ iCloud: CardDAV API Real');
});

process.on('SIGTERM', () => { log('Recebido SIGTERM, encerrando servidor...', 'warn'); process.exit(0); });
process.on('SIGINT', () => { log('Recebido SIGINT, encerrando servidor...', 'warn'); process.exit(0); });
