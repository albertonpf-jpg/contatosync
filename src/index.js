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

// =============================================
// SUPABASE
// =============================================
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

async function dbGet(table, filters) {
    let url = SUPABASE_URL + '/rest/v1/' + table + '?select=*';
    if (filters) {
        Object.entries(filters).forEach(([k, v]) => { url += '&' + k + '=eq.' + encodeURIComponent(v); });
    }
    const r = await axios.get(url, { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } });
    return r.data;
}

async function dbUpsert(table, data) {
    await axios.post(SUPABASE_URL + '/rest/v1/' + table, data, {
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates'
        }
    });
}

async function loadFromSupabase() {
    try {
        const [contacts, configRows] = await Promise.all([dbGet('contacts'), dbGet('config')]);
        const sequencerRow = configRows.find(r => r.key === 'sequencer');
        const googleRow = configRows.find(r => r.key === 'google_tokens');
        return {
            contacts: contacts || [],
            sequencer: sequencerRow ? sequencerRow.value : { prefix: 'Contato Zap', current: 1 },
            googleTokens: googleRow ? googleRow.value : null
        };
    } catch (e) {
        console.error('Erro ao carregar do Supabase:', e.message);
        return { contacts: [], sequencer: { prefix: 'Contato Zap', current: 1 }, googleTokens: null };
    }
}

async function saveSequencer() {
    try { await dbUpsert('config', { key: 'sequencer', value: appState.sequencer, updated_at: new Date().toISOString() }); }
    catch (e) { console.error('Erro ao salvar sequencer:', e.message); }
}

async function saveGoogleTokens(tokens) {
    try { await dbUpsert('config', { key: 'google_tokens', value: tokens, updated_at: new Date().toISOString() }); }
    catch (e) { console.error('Erro ao salvar tokens Google:', e.message); }
}

async function saveContact(contact) {
    try {
        await dbUpsert('contacts', {
            id: contact.id,
            phone: contact.phone,
            name: contact.name || null,
            push_name: contact.pushName || null,
            pending: contact.pending || false,
            has_real_phone: contact.hasRealPhone || true,
            saved_to_agenda: contact.savedToAgenda || false,
            erro_agenda: contact.erroAgenda || null,
            source: contact.source || 'whatsapp',
            detected_at: contact.detected || new Date().toISOString(),
            saved_at: contact.savedAt || new Date().toISOString()
        });
    } catch (e) { console.error('Erro ao salvar contato:', e.message); }
}

// =============================================
// ESTADO
// =============================================
let appState = {
    whatsapp: { connected: false, qr: null, phone: null, lastActivity: null, autoSave: true, socket: null, chatsCache: [] },
    google: { connected: false, accessToken: null, refreshToken: null, profile: null, oauth2Client: null },
    icloud: { connected: false, appleId: null, appPassword: null, addressBookUrl: null, lastSync: null },
    sequencer: { prefix: 'Contato Zap', current: 1 },
    contacts: [], logs: [],
    stats: { total: 0, pending: 0, savedToday: 0 },
    sync: { running: false, progress: 0, total: 0, saved: 0, skipped: 0, errors: 0, lastRun: null },
    loaded: false
};

let sseClients = [];
let baileysModule = null;

async function initData() {
    try {
        console.log('📦 Carregando dados do Supabase...');
        const data = await loadFromSupabase();
        appState.contacts = data.contacts.map(c => ({
            id: c.id, phone: c.phone, name: c.name, pushName: c.push_name,
            pending: c.pending, hasRealPhone: c.has_real_phone,
            savedToAgenda: c.saved_to_agenda, erroAgenda: c.erro_agenda,
            source: c.source, detected: c.detected_at, savedAt: c.saved_at
        }));
        appState.sequencer = data.sequencer;
        appState.stats.total = appState.contacts.length;
        appState.stats.pending = appState.contacts.filter(c => c.pending).length;
        appState.loaded = true;
        console.log('✅ Dados carregados: ' + appState.contacts.length + ' contatos, sequencer: ' + appState.sequencer.current);
        if (data.googleTokens) restoreGoogleTokens(data.googleTokens);
    } catch (e) {
        console.error('Erro ao iniciar dados:', e.message);
        appState.loaded = true;
    }
}

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
    console.log('[' + timestamp + '] [' + type.toUpperCase() + '] ' + message);
    appState.logs.unshift({ timestamp, message, type });
    if (appState.logs.length > 100) appState.logs.pop();
}

function broadcast(event, data) {
    const message = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
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
        return base + ' - ' + pushName.trim().split(' ')[0];
    }
    return base;
}

// =============================================
// GOOGLE
// =============================================
function initGoogleOAuth() {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID || '',
        process.env.GOOGLE_CLIENT_SECRET || '',
        process.env.GOOGLE_REDIRECT_URI || 'https://web-production-a17bb.up.railway.app/auth/google/callback'
    );
    appState.google.oauth2Client = oauth2Client;
    return oauth2Client.generateAuthUrl({
        access_type: 'offline', prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/contacts', 'https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email']
    });
}

async function handleGoogleCallback(code) {
    const { tokens } = await appState.google.oauth2Client.getToken(code);
    appState.google.oauth2Client.setCredentials(tokens);
    appState.google.accessToken = tokens.access_token;
    appState.google.refreshToken = tokens.refresh_token;
    await saveGoogleTokens({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token });
    const oauth2 = google.oauth2('v2');
    const userInfo = await oauth2.userinfo.get({ auth: appState.google.oauth2Client });
    appState.google.profile = { email: userInfo.data.email, name: userInfo.data.name, picture: userInfo.data.picture };
    appState.google.connected = true;
    log('Google conectado: ' + appState.google.profile.email);
    broadcast('agenda-update', { google: true, profile: appState.google.profile });
    return { ok: true, profile: appState.google.profile };
}

function restoreGoogleTokens(tokens) {
    try {
        const oauth2Client = new google.auth.OAuth2(
            process.env.GOOGLE_CLIENT_ID || '',
            process.env.GOOGLE_CLIENT_SECRET || '',
            process.env.GOOGLE_REDIRECT_URI || 'https://web-production-a17bb.up.railway.app/auth/google/callback'
        );
        oauth2Client.setCredentials({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
        oauth2Client.on('tokens', async (newTokens) => {
            if (newTokens.access_token) {
                appState.google.accessToken = newTokens.access_token;
                await saveGoogleTokens({ accessToken: newTokens.access_token, refreshToken: tokens.refreshToken });
                debugLog('Token Google renovado automaticamente');
            }
        });
        appState.google.oauth2Client = oauth2Client;
        appState.google.accessToken = tokens.accessToken;
        appState.google.refreshToken = tokens.refreshToken;
        appState.google.connected = true;
        debugLog('Tokens Google restaurados do Supabase');
    } catch (e) { debugLog('Erro ao restaurar tokens Google: ' + e.message); }
}

async function saveContactToGoogle(phone, name) {
    if (!appState.google.connected || !appState.google.oauth2Client) throw new Error('Google não conectado');
    const peopleApi = google.people({ version: 'v1', auth: appState.google.oauth2Client });
    await peopleApi.people.createContact({
        requestBody: { names: [{ givenName: name }], phoneNumbers: [{ value: phone, type: 'mobile' }] }
    });
    return true;
}

async function isPhoneInGoogle(phone) {
    if (!appState.google.connected || !appState.google.oauth2Client) return false;
    try {
        const peopleApi = google.people({ version: 'v1', auth: appState.google.oauth2Client });
        const res = await peopleApi.people.searchContacts({ query: phone.replace('+', ''), readMask: 'phoneNumbers', pageSize: 1 });
        return (res.data.results || []).length > 0;
    } catch (e) { return false; }
}

async function isPhoneInICloud(phone) {
    if (!appState.icloud.connected || !appState.icloud.addressBookUrl) return false;
    try {
        const cleanPhone = phone.replace(/\D/g, '');
        const reportXml = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
    <D:prop><D:getetag/><C:address-data/></D:prop>
    <C:filter>
        <C:prop-filter name="TEL">
            <C:text-match collation="i;unicode-casemap" match-type="contains">${cleanPhone.slice(-8)}</C:text-match>
        </C:prop-filter>
    </C:filter>
</C:addressbook-query>`;

        const response = await axios({
            method: 'REPORT',
            url: appState.icloud.addressBookUrl,
            auth: { username: appState.icloud.appleId, password: appState.icloud.appPassword },
            headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Depth': '1' },
            data: reportXml,
            timeout: 10000,
            validateStatus: (s) => s < 500
        });

        return response.data && response.data.includes('<C:address-data>');
    } catch (e) { return false; }
}

// =============================================
// ICLOUD CardDAV — salvamento implementado
// =============================================

// Descobre a URL real do addressbook do iCloud via PROPFIND
async function discoverICloudAddressBook(appleId, appPassword) {
    try {
        // Passo 1: descobrir o principal do usuario
        const principalResp = await axios({
            method: 'PROPFIND',
            url: 'https://contacts.icloud.com/',
            auth: { username: appleId, password: appPassword },
            headers: {
                'Content-Type': 'application/xml; charset=utf-8',
                'Depth': '0'
            },
            data: '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>',
            timeout: 15000,
            validateStatus: (s) => s < 500
        });

        if (principalResp.status === 401) throw new Error('Credenciais inválidas');

        // Extrair href do principal
        const principalMatch = principalResp.data.match(/<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/i);
        if (!principalMatch) {
            // Fallback: tentar URL direta com ID da conta
            const accountId = appleId.replace('@', '%40');
            return 'https://contacts.icloud.com/' + accountId + '/carddavhome/card/';
        }

        let principalHref = principalMatch[1].trim();
        debugLog('iCloud principal href: ' + principalHref);

        // Passo 2: descobrir o home set do carddav
        const homeSetResp = await axios({
            method: 'PROPFIND',
            url: principalHref.startsWith('http') ? principalHref : 'https://contacts.icloud.com' + principalHref,
            auth: { username: appleId, password: appPassword },
            headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Depth': '0' },
            data: '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav"><D:prop><C:addressbook-home-set/></D:prop></D:propfind>',
            timeout: 15000,
            validateStatus: (s) => s < 500
        });

        const homeMatch = homeSetResp.data.match(/addressbook-home-set[^>]*>\s*<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/i);
        if (!homeMatch) throw new Error('Não foi possível descobrir o addressbook home set');

        let homeHref = homeMatch[1].trim();
        if (!homeHref.startsWith('http')) homeHref = 'https://contacts.icloud.com' + homeHref;
        debugLog('iCloud addressbook home: ' + homeHref);

        return homeHref;
    } catch (e) {
        debugLog('Erro ao descobrir addressbook: ' + e.message);
        // Fallback seguro
        const numericId = appleId.split('@')[0];
        return 'https://contacts.icloud.com/' + numericId + '/carddavhome/card/';
    }
}

async function connectICloud(appleId, appPassword) {
    // Verificar credenciais com PROPFIND simples
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
    if (response.status !== 207 && response.status !== 200) throw new Error('Resposta inesperada do iCloud: ' + response.status);

    // Descobrir URL do addressbook
    debugLog('Descobrindo addressbook do iCloud...');
    const addressBookUrl = await discoverICloudAddressBook(appleId, appPassword);
    debugLog('iCloud addressBook URL: ' + addressBookUrl);

    appState.icloud.connected = true;
    appState.icloud.appleId = appleId;
    appState.icloud.appPassword = appPassword;
    appState.icloud.addressBookUrl = addressBookUrl;
    appState.icloud.lastSync = new Date().toISOString();
    log('iCloud conectado: ' + appleId);
    broadcast('agenda-update', { icloud: true });
    return { ok: true, message: 'iCloud conectado com sucesso' };
}

// Salva contato no iCloud via CardDAV (PUT com vCard)
async function saveContactToICloud(phone, name) {
    if (!appState.icloud.connected || !appState.icloud.appleId || !appState.icloud.appPassword) {
        throw new Error('iCloud não conectado');
    }

    // Gerar UID único para o contato
    const uid = 'contatosync-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();

    // Montar vCard 3.0
    const firstName = name.split(' - ')[1] || name; // extrair nome real se houver "Contato Zap 1 - Alberto"
    const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'UID:' + uid,
        'FN:' + name,
        'N:' + name + ';;;;',
        'TEL;TYPE=CELL:' + phone,
        'END:VCARD'
    ].join('\r\n');

    const contactUrl = appState.icloud.addressBookUrl + uid + '.vcf';

    debugLog('Salvando no iCloud: ' + name + ' → ' + contactUrl);

    await axios({
        method: 'PUT',
        url: contactUrl,
        auth: { username: appState.icloud.appleId, password: appState.icloud.appPassword },
        headers: {
            'Content-Type': 'text/vcard; charset=utf-8',
            'If-None-Match': '*'  // cria novo, não sobrescreve
        },
        data: vcard,
        timeout: 15000,
        validateStatus: (s) => s < 500
    });

    debugLog('Contato salvo no iCloud: ' + name + ' (' + phone + ')');
    return true;
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
        let chats = appState.whatsapp.chatsCache || [];
        const individualChats = chats.filter(c => {
            const id = c.id || c.jid || '';
            return !id.endsWith('@g.us') && !id.endsWith('@broadcast') && id.includes('@');
        });

        appState.sync.total = individualChats.length;
        broadcast('sync-update', { ...appState.sync, status: 'processando', total: individualChats.length });

        if (individualChats.length === 0) {
            appState.sync.running = false;
            broadcast('sync-update', { ...appState.sync, status: 'concluido' });
            return { ok: true, saved: 0, skipped: 0, errors: 0, total: 0, message: 'Nenhum chat encontrado. Aguarde alguns minutos após conectar o WhatsApp e tente novamente.' };
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

                const jaNoGoogle = appState.google.connected ? await isPhoneInGoogle(phone) : false;
                const jaNoICloud = appState.icloud.connected ? await isPhoneInICloud(phone) : false;

                if ((appState.google.connected && jaNoGoogle) && (appState.icloud.connected && jaNoICloud)) {
                    appState.sync.skipped++;
                    const c = { id: 'contact_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6), phone, name: chat.name || phone, pushName: chat.name || null, pending: false, hasRealPhone: true, savedToAgenda: true, erroAgenda: null, detected: new Date().toISOString(), savedAt: new Date().toISOString(), source: 'sync-existing' };
                    appState.contacts.push(c);
                    await saveContact(c);
                    continue;
                }

                if (jaNoGoogle && !appState.icloud.connected) {
                    appState.sync.skipped++;
                    const c = { id: 'contact_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6), phone, name: chat.name || phone, pushName: chat.name || null, pending: false, hasRealPhone: true, savedToAgenda: true, erroAgenda: null, detected: new Date().toISOString(), savedAt: new Date().toISOString(), source: 'sync-existing' };
                    appState.contacts.push(c);
                    await saveContact(c);
                    continue;
                }

                if (jaNoICloud && !appState.google.connected) {
                    appState.sync.skipped++;
                    const c = { id: 'contact_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6), phone, name: chat.name || phone, pushName: chat.name || null, pending: false, hasRealPhone: true, savedToAgenda: true, erroAgenda: null, detected: new Date().toISOString(), savedAt: new Date().toISOString(), source: 'sync-existing' };
                    appState.contacts.push(c);
                    await saveContact(c);
                    continue;
                }

                const name = buildContactName(chat.name || null);
                appState.sequencer.current++;
                await saveSequencer();

                let savedAgenda = false;
                let erroAgenda = null;

                if (appState.google.connected && !jaNoGoogle) {
                    try { await saveContactToGoogle(phone, name); savedAgenda = true; }
                    catch (e) { erroAgenda = 'Google: ' + e.message; appState.sync.errors++; }
                }

                if (appState.icloud.connected && !jaNoICloud) {
                    try { await saveContactToICloud(phone, name); savedAgenda = true; }
                    catch (e) {
                        erroAgenda = (erroAgenda ? erroAgenda + ' | ' : '') + 'iCloud: ' + e.message;
                        appState.sync.errors++;
                    }
                }

                const contact = { id: 'contact_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6), phone, name, pushName: chat.name || null, pending: false, hasRealPhone: true, savedToAgenda: savedAgenda, erroAgenda: erroAgenda || null, detected: new Date().toISOString(), savedAt: new Date().toISOString(), source: 'sync' };
                appState.contacts.push(contact);
                await saveContact(contact);
                appState.stats.total++;
                appState.stats.savedToday++;
                if (savedAgenda) appState.sync.saved++;
                broadcast('contact', contact);
            }

            appState.sync.progress = Math.min(i + BATCH_SIZE, individualChats.length);
            broadcast('sync-update', { ...appState.sync, status: 'processando' });
            if (i + BATCH_SIZE < individualChats.length) await delay(BATCH_DELAY);
        }

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
async function initWhatsApp() {
    try {
        const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = await loadBaileys();
        const sessionPath = './whatsapp_session';
        if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version, auth: state, printQRInTerminal: false,
            logger: makeSilentLogger(), browser: ['ContatoSync', 'Chrome', '120.0.0']
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
                appState.whatsapp.connected = false;
                appState.whatsapp.phone = null;
                appState.whatsapp.qr = null;
                broadcast('disconnected', { status: 'disconnected', statusCode });
                if (statusCode !== DisconnectReason.loggedOut) setTimeout(() => initWhatsApp(), 3000);
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

        sock.ev.on('chats.set', ({ chats }) => {
            debugLog('chats.set: ' + chats.length + ' chats');
            appState.whatsapp.chatsCache = chats || [];
        });

        sock.ev.on('chats.upsert', (chats) => {
            chats.forEach(c => {
                if (!appState.whatsapp.chatsCache.find(x => x.id === c.id))
                    appState.whatsapp.chatsCache.push(c);
            });
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
                if (!phone) { debugLog('Não foi possível extrair número de: ' + jid); continue; }

                const jaExiste = appState.contacts.find(c => c.phone === phone);
                if (jaExiste) { debugLog('Contato já existe: ' + phone); continue; }

                const jaNoGoogle = appState.google.connected ? await isPhoneInGoogle(phone) : false;
                const jaNoICloud = appState.icloud.connected ? await isPhoneInICloud(phone) : false;

                if ((appState.google.connected && jaNoGoogle) && (appState.icloud.connected && jaNoICloud)) {
                    debugLog('Contato já existe nas agendas: ' + phone);
                    continue;
                }
                if (jaNoGoogle && !appState.icloud.connected) {
                    debugLog('Contato já existe no Google: ' + phone);
                    continue;
                }
                if (jaNoICloud && !appState.google.connected) {
                    debugLog('Contato já existe no iCloud: ' + phone);
                    continue;
                }

                const name = buildContactName(msg.pushName);
                appState.sequencer.current++;
                await saveSequencer();

                let savedAgenda = false;
                let erroAgenda = null;

                if (appState.google.connected && !jaNoGoogle) {
                    try { await saveContactToGoogle(phone, name); savedAgenda = true; }
                    catch (e) { erroAgenda = 'Google: ' + e.message; debugLog('Erro Google: ' + e.message); }
                }

                if (appState.icloud.connected && !jaNoICloud) {
                    try { await saveContactToICloud(phone, name); savedAgenda = true; }
                    catch (e) {
                        erroAgenda = (erroAgenda ? erroAgenda + ' | ' : '') + 'iCloud: ' + e.message;
                        debugLog('Erro iCloud: ' + e.message);
                    }
                }

                const contact = {
                    id: 'contact_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                    phone, name, pushName: msg.pushName || null,
                    pending: false, hasRealPhone: true,
                    savedToAgenda: savedAgenda, erroAgenda: erroAgenda || null,
                    detected: new Date().toISOString(), savedAt: new Date().toISOString(),
                    source: 'whatsapp'
                };

                appState.contacts.push(contact);
                await saveContact(contact);
                appState.stats.total++;
                appState.stats.savedToday++;
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

// =============================================
// ROTAS
// =============================================
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/health', (req, res) => { res.json({ status: 'ok', uptime: process.uptime(), mode: 'PRODUCTION', supabase: !!SUPABASE_URL }); });
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
        const sessionPath = './whatsapp_session';
        if (fs.existsSync(sessionPath)) fs.rmSync(sessionPath, { recursive: true, force: true });
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

app.post('/auth/google/disconnect', async (req, res) => {
    appState.google.connected = false;
    appState.google.profile = null;
    appState.google.accessToken = null;
    appState.google.refreshToken = null;
    appState.google.oauth2Client = null;
    await dbUpsert('config', { key: 'google_tokens', value: null, updated_at: new Date().toISOString() }).catch(() => {});
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
    appState.icloud.appPassword = null;
    appState.icloud.addressBookUrl = null;
    broadcast('agenda-update', { icloud: false });
    res.json({ ok: true });
});

app.get('/sequencer', (req, res) => res.json(appState.sequencer));

app.get('/contacts', async (req, res) => {
    try {
        const contacts = await dbGet('contacts');
        res.json(contacts || []);
    } catch (e) {
        log('Erro ao buscar contatos: ' + e.message, 'error');
        res.json([]);
    }
});

app.put('/sequencer', async (req, res) => {
    const { prefix, current } = req.body;
    if (prefix) appState.sequencer.prefix = prefix;
    if (current && !isNaN(current)) appState.sequencer.current = parseInt(current);
    await saveSequencer();
    res.json(appState.sequencer);
});

app.post('/contacts/save', async (req, res) => {
    const { contactId } = req.body;
    const contact = appState.contacts.find(c => c.id === contactId || c.phone === contactId);
    if (!contact) return res.json({ ok: false, message: 'Contato não encontrado' });
    if (!contact.pending) return res.json({ ok: false, message: 'Já salvo' });

    const jaNoGoogle = appState.google.connected ? await isPhoneInGoogle(contact.phone) : false;
    const jaNoICloud = appState.icloud.connected ? await isPhoneInICloud(contact.phone) : false;

    const name = buildContactName(contact.pushName || null);
    if (appState.google.connected && !jaNoGoogle) {
        try { await saveContactToGoogle(contact.phone, name); } catch (e) { debugLog('Erro Google: ' + e.message); }
    }
    if (appState.icloud.connected && !jaNoICloud) {
        try { await saveContactToICloud(contact.phone, name); } catch (e) { debugLog('Erro iCloud: ' + e.message); }
    }
    contact.name = name;
    contact.pending = false;
    contact.savedAt = new Date().toISOString();
    contact.source = 'manual';
    appState.sequencer.current++;
    await saveSequencer();
    await saveContact(contact);
    appState.stats.pending--;
    appState.stats.savedToday++;
    res.json({ ok: true, contact });
});

app.post('/contacts/save-all', async (req, res) => {
    const pending = appState.contacts.filter(c => c.pending);
    if (!pending.length) return res.json({ ok: false, message: 'Nenhum pendente' });
    let saved = 0;
    for (const c of pending) {
        const jaNoGoogle = appState.google.connected ? await isPhoneInGoogle(c.phone) : false;
        const jaNoICloud = appState.icloud.connected ? await isPhoneInICloud(c.phone) : false;

        const name = buildContactName(c.pushName || null);
        if (appState.google.connected && !jaNoGoogle) { try { await saveContactToGoogle(c.phone, name); } catch (e) {} }
        if (appState.icloud.connected && !jaNoICloud) { try { await saveContactToICloud(c.phone, name); } catch (e) {} }
        c.name = name;
        c.pending = false;
        c.savedAt = new Date().toISOString();
        c.source = 'bulk';
        appState.sequencer.current++;
        await saveContact(c);
        saved++;
    }
    await saveSequencer();
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
app.listen(PORT, async () => {
    log('🚀 ContatoSync iniciado na porta ' + PORT);
    await initData();
    initWhatsApp().catch(e => log('Erro ao iniciar WhatsApp: ' + e.message, 'error'));
});

process.on('SIGTERM', () => { log('Encerrando...'); process.exit(0); });
process.on('SIGINT', () => { log('Encerrando...'); process.exit(0); });
