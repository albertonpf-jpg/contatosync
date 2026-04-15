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

async function dbDelete(table, filters) {
    let url = SUPABASE_URL + '/rest/v1/' + table + '?';
    const params = Object.entries(filters).map(([k, v]) => k + '=eq.' + encodeURIComponent(v));
    url += params.join('&');
    await axios.delete(url, {
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: 'Bearer ' + SUPABASE_KEY
        }
    });
}

async function loadFromSupabase() {
    try {
        const [contacts, configRows] = await Promise.all([dbGet('contacts'), dbGet('config')]);
        const sequencerRow = configRows.find(r => r.key === 'sequencer');
        const googleRow = configRows.find(r => r.key === 'google_tokens');
        const icloudRow = configRows.find(r => r.key === 'icloud_config');
        return {
            contacts: contacts || [],
            sequencer: sequencerRow ? sequencerRow.value : { prefix: 'Contato Zap', current: 1 },
            googleTokens: googleRow ? googleRow.value : null,
            icloudConfig: icloudRow ? icloudRow.value : null
        };
    } catch (e) {
        console.error('Erro ao carregar do Supabase:', e.message);
        return { contacts: [], sequencer: { prefix: 'Contato Zap', current: 1 }, googleTokens: null, icloudConfig: null };
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

async function saveICloudConfig(appleId, appPassword, addressBookUrl) {
    try {
        await dbUpsert('config', {
            key: 'icloud_config',
            value: { appleId, appPassword, addressBookUrl },
            updated_at: new Date().toISOString()
        });
        debugLog('iCloud config salvo no Supabase');
    } catch (e) { console.error('Erro ao salvar iCloud config:', e.message); }
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
            google_resource_name: contact.googleResourceName || null,
            icloud_vcard_url: contact.icloudVcardUrl || null,
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
            source: c.source,
            googleResourceName: c.google_resource_name || null,
            icloudVcardUrl: c.icloud_vcard_url || null,
            detected: c.detected_at, savedAt: c.saved_at
        }));
        appState.sequencer = data.sequencer;
        appState.stats.total = appState.contacts.length;
        appState.stats.pending = appState.contacts.filter(c => c.pending).length;
        appState.loaded = true;
        console.log('✅ Dados carregados: ' + appState.contacts.length + ' contatos, sequencer: ' + appState.sequencer.current);
        if (data.googleTokens) restoreGoogleTokens(data.googleTokens);
        if (data.icloudConfig) restoreICloudConfig(data.icloudConfig);
        await loadAutoReplyConfig();
    } catch (e) {
        console.error('Erro ao iniciar dados:', e.message);
        appState.loaded = true;
    }
}

function restoreICloudConfig(config) {
    try {
        appState.icloud.connected = true;
        appState.icloud.appleId = config.appleId;
        appState.icloud.appPassword = config.appPassword;
        appState.icloud.addressBookUrl = config.addressBookUrl;
        debugLog('iCloud restaurado do Supabase: ' + config.appleId + ' → ' + config.addressBookUrl);
    } catch (e) {
        debugLog('Erro ao restaurar iCloud config: ' + e.message);
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
    const res = await peopleApi.people.createContact({
        requestBody: { names: [{ givenName: name }], phoneNumbers: [{ value: phone, type: 'mobile' }] }
    });
    return res.data.resourceName || null;
}

async function deleteContactFromGoogle(resourceName) {
    if (!appState.google.connected || !appState.google.oauth2Client) throw new Error('Google não conectado');
    if (!resourceName) throw new Error('resourceName ausente');
    const peopleApi = google.people({ version: 'v1', auth: appState.google.oauth2Client });
    await peopleApi.people.deleteContact({ resourceName });
    return true;
}

async function findGoogleResourceByPhone(phone) {
    if (!appState.google.connected || !appState.google.oauth2Client) return null;
    try {
        const peopleApi = google.people({ version: 'v1', auth: appState.google.oauth2Client });
        const res = await peopleApi.people.searchContacts({ query: phone.replace('+', ''), readMask: 'phoneNumbers', pageSize: 5 });
        const results = res.data.results || [];
        const cleanTarget = phone.replace(/\D/g, '');
        for (const r of results) {
            const phones = r.person?.phoneNumbers || [];
            for (const p of phones) {
                const clean = (p.value || '').replace(/\D/g, '');
                if (clean === cleanTarget || clean.endsWith(cleanTarget.slice(-8))) {
                    return r.person.resourceName;
                }
            }
        }
        return null;
    } catch (e) {
        debugLog('Erro ao buscar resource Google: ' + e.message);
        return null;
    }
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
// ICLOUD CardDAV
// =============================================
async function discoverICloudAddressBook(appleId, appPassword) {
    debugLog('=== INICIANDO DESCOBERTA ADDRESSBOOK ICLOUD ===');

    const principalResp = await axios({
        method: 'PROPFIND',
        url: 'https://contacts.icloud.com/',
        auth: { username: appleId, password: appPassword },
        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Depth': '0' },
        data: '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:current-user-principal/></D:prop></D:propfind>',
        timeout: 15000,
        validateStatus: () => true
    });

    debugLog('Principal status: ' + principalResp.status);
    const rawData = String(principalResp.data);
    debugLog('Principal data: ' + rawData.substring(0, 800));

    if (principalResp.status === 401) throw new Error('Credenciais invalidas');

    const idMatch = rawData.match(/<href>\s*\/(\d{6,})\/principal\/\s*<\/href>/i);
    if (!idMatch) throw new Error('ID numerico do principal nao encontrado');

    const numericId = idMatch[1];
    const addressBookUrl = 'https://contacts.icloud.com/' + numericId + '/carddavhome/card/';
    debugLog('ID numerico: ' + numericId);
    debugLog('AddressBook URL: ' + addressBookUrl);

    const testResp = await axios({
        method: 'PROPFIND',
        url: addressBookUrl,
        auth: { username: appleId, password: appPassword },
        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Depth': '0' },
        data: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/></D:prop></D:propfind>',
        timeout: 10000,
        validateStatus: () => true
    });

    debugLog('Teste addressbook status: ' + testResp.status);
    if (testResp.status >= 400) throw new Error('AddressBook URL invalida: status ' + testResp.status);

    return addressBookUrl;
}

async function connectICloud(appleId, appPassword) {
    const response = await axios({
        method: 'PROPFIND',
        url: 'https://contacts.icloud.com/',
        auth: { username: appleId, password: appPassword },
        headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Depth': '0' },
        data: '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/></D:prop></D:propfind>',
        timeout: 15000,
        validateStatus: (s) => s < 600
    });

    debugLog('connectICloud status: ' + response.status);

    if (response.status === 401) throw new Error('Credenciais inválidas. Verifique seu Apple ID e a App-Specific Password.');
    if (response.status !== 207 && response.status !== 200) throw new Error('Resposta inesperada do iCloud: ' + response.status);

    const addressBookUrl = await discoverICloudAddressBook(appleId, appPassword);
    debugLog('iCloud addressBook URL final: ' + addressBookUrl);

    try {
        const testResp = await axios({
            method: 'PROPFIND',
            url: addressBookUrl,
            auth: { username: appleId, password: appPassword },
            headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Depth': '0' },
            data: '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/></D:prop></D:propfind>',
            timeout: 10000,
            validateStatus: (s) => s < 600
        });
        debugLog('Teste addressbook URL status: ' + testResp.status);
    } catch (e) {
        debugLog('Erro ao testar addressbook URL: ' + e.message);
    }

    appState.icloud.connected = true;
    appState.icloud.appleId = appleId;
    appState.icloud.appPassword = appPassword;
    appState.icloud.addressBookUrl = addressBookUrl;
    appState.icloud.lastSync = new Date().toISOString();

    await saveICloudConfig(appleId, appPassword, addressBookUrl);

    log('iCloud conectado: ' + appleId);
    broadcast('agenda-update', { icloud: true });
    return { ok: true, message: 'iCloud conectado com sucesso', addressBookUrl };
}

async function saveContactToICloud(phone, name) {
    if (!appState.icloud.connected || !appState.icloud.appleId || !appState.icloud.appPassword) {
        throw new Error('iCloud não conectado');
    }
    if (!appState.icloud.addressBookUrl) {
        throw new Error('addressBookUrl ausente — reconecte o iCloud');
    }

    const uid = 'contatosync-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase();

    const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'UID:' + uid,
        'FN:' + name,
        'N:' + name + ';;;;',
        'TEL;TYPE=CELL:' + phone,
        'END:VCARD'
    ].join('\r\n') + '\r\n';

    const baseUrl = appState.icloud.addressBookUrl.endsWith('/')
        ? appState.icloud.addressBookUrl
        : appState.icloud.addressBookUrl + '/';
    const contactUrl = baseUrl + uid + '.vcf';

    debugLog('=== SALVANDO NO ICLOUD ===');
    debugLog('Nome: ' + name + ' | Phone: ' + phone);
    debugLog('URL: ' + contactUrl);

    const response = await axios({
        method: 'PUT',
        url: contactUrl,
        auth: { username: appState.icloud.appleId, password: appState.icloud.appPassword },
        headers: { 'Content-Type': 'text/vcard; charset=utf-8', 'If-None-Match': '*' },
        data: vcard,
        timeout: 15000,
        validateStatus: () => true
    });

    debugLog('iCloud PUT status: ' + response.status);
    if (response.data) debugLog('iCloud PUT response: ' + String(response.data).substring(0, 300));

    if (response.status === 201 || response.status === 204) {
        debugLog('✅ Contato salvo no iCloud: ' + name);
        return contactUrl;
    } else if (response.status === 412) {
        const uid2 = 'contatosync-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9).toUpperCase() + 'B';
        const vcard2 = ['BEGIN:VCARD','VERSION:3.0','UID:' + uid2,'FN:' + name,'N:' + name + ';;;;','TEL;TYPE=CELL:' + phone,'END:VCARD'].join('\r\n') + '\r\n';
        const contactUrl2 = baseUrl + uid2 + '.vcf';
        const resp2 = await axios({
            method: 'PUT', url: contactUrl2,
            auth: { username: appState.icloud.appleId, password: appState.icloud.appPassword },
            headers: { 'Content-Type': 'text/vcard; charset=utf-8' },
            data: vcard2, timeout: 15000, validateStatus: () => true
        });
        debugLog('iCloud PUT retry status: ' + resp2.status);
        if (resp2.status === 201 || resp2.status === 204) return contactUrl2;
        throw new Error('iCloud PUT falhou após retry: status ' + resp2.status + ' | ' + String(resp2.data).substring(0, 200));
    } else if (response.status === 401) {
        throw new Error('iCloud: credenciais inválidas (401)');
    } else if (response.status === 403) {
        throw new Error('iCloud: acesso negado (403)');
    } else if (response.status === 404) {
        throw new Error('iCloud: addressbook não encontrado (404) URL: ' + contactUrl + ' — reconecte o iCloud');
    } else {
        throw new Error('iCloud PUT status inesperado: ' + response.status + ' | ' + String(response.data).substring(0, 200));
    }
}

async function deleteContactFromICloud(vcardUrl) {
    if (!appState.icloud.connected || !appState.icloud.appleId || !appState.icloud.appPassword) {
        throw new Error('iCloud não conectado');
    }
    if (!vcardUrl) throw new Error('vcardUrl ausente');

    debugLog('Deletando do iCloud: ' + vcardUrl);

    const response = await axios({
        method: 'DELETE',
        url: vcardUrl,
        auth: { username: appState.icloud.appleId, password: appState.icloud.appPassword },
        timeout: 15000,
        validateStatus: () => true
    });

    debugLog('iCloud DELETE status: ' + response.status);

    if (response.status >= 400 && response.status !== 404) {
        throw new Error('iCloud DELETE status ' + response.status);
    }
    return true;
}

async function findICloudVcardByPhone(phone) {
    if (!appState.icloud.connected || !appState.icloud.addressBookUrl) return null;
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
        if (!response.data) return null;
        const hrefMatch = response.data.match(/<[^>]*href[^>]*>([^<]+\.vcf)<\/[^>]*href>/i);
        if (!hrefMatch) return null;
        let href = hrefMatch[1].trim();
        if (!href.startsWith('http')) {
            const baseUrl = new URL(appState.icloud.addressBookUrl);
            href = baseUrl.origin + href;
        }
        return href;
    } catch (e) {
        debugLog('Erro ao buscar vCard iCloud: ' + e.message);
        return null;
    }
}

// =============================================
// DELETE CONTATO
// =============================================
async function deleteContactEverywhere(contact) {
    const errors = [];
    let googleOk = false;
    let icloudOk = false;

    if (appState.google.connected) {
        try {
            let resourceName = contact.googleResourceName;
            if (!resourceName) resourceName = await findGoogleResourceByPhone(contact.phone);
            if (resourceName) { await deleteContactFromGoogle(resourceName); googleOk = true; }
            else googleOk = true;
        } catch (e) { errors.push('Google: ' + e.message); }
    }

    if (appState.icloud.connected) {
        try {
            let vcardUrl = contact.icloudVcardUrl;
            if (!vcardUrl) vcardUrl = await findICloudVcardByPhone(contact.phone);
            if (vcardUrl) { await deleteContactFromICloud(vcardUrl); icloudOk = true; }
            else icloudOk = true;
        } catch (e) { errors.push('iCloud: ' + e.message); }
    }

    try {
        await dbDelete('contacts', { id: contact.id });
    } catch (e) {
        errors.push('Supabase: ' + e.message);
        throw new Error('Falha ao deletar do Supabase: ' + e.message);
    }

    const idx = appState.contacts.findIndex(c => c.id === contact.id);
    if (idx >= 0) {
        appState.contacts.splice(idx, 1);
        appState.stats.total = appState.contacts.length;
        appState.stats.pending = appState.contacts.filter(c => c.pending).length;
    }

    return { googleOk, icloudOk, errors };
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
            return { ok: true, saved: 0, skipped: 0, errors: 0, total: 0, message: 'Nenhum chat encontrado.' };
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
                    appState.contacts.push(c); await saveContact(c); continue;
                }
                if (jaNoGoogle && !appState.icloud.connected) {
                    appState.sync.skipped++;
                    const c = { id: 'contact_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6), phone, name: chat.name || phone, pushName: chat.name || null, pending: false, hasRealPhone: true, savedToAgenda: true, erroAgenda: null, detected: new Date().toISOString(), savedAt: new Date().toISOString(), source: 'sync-existing' };
                    appState.contacts.push(c); await saveContact(c); continue;
                }
                if (jaNoICloud && !appState.google.connected) {
                    appState.sync.skipped++;
                    const c = { id: 'contact_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6), phone, name: chat.name || phone, pushName: chat.name || null, pending: false, hasRealPhone: true, savedToAgenda: true, erroAgenda: null, detected: new Date().toISOString(), savedAt: new Date().toISOString(), source: 'sync-existing' };
                    appState.contacts.push(c); await saveContact(c); continue;
                }

                const name = buildContactName(chat.name || null);
                appState.sequencer.current++;
                await saveSequencer();

                let savedAgenda = false;
                let erroAgenda = null;
                let googleResourceName = null;
                let icloudVcardUrl = null;

                if (appState.google.connected && !jaNoGoogle) {
                    try { googleResourceName = await saveContactToGoogle(phone, name); savedAgenda = true; }
                    catch (e) { erroAgenda = 'Google: ' + e.message; appState.sync.errors++; }
                }
                if (appState.icloud.connected && !jaNoICloud) {
                    try { icloudVcardUrl = await saveContactToICloud(phone, name); savedAgenda = true; }
                    catch (e) { erroAgenda = (erroAgenda ? erroAgenda + ' | ' : '') + 'iCloud: ' + e.message; appState.sync.errors++; }
                }

                const contact = { id: 'contact_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6), phone, name, pushName: chat.name || null, pending: false, hasRealPhone: true, savedToAgenda: savedAgenda, erroAgenda: erroAgenda || null, googleResourceName, icloudVcardUrl, detected: new Date().toISOString(), savedAt: new Date().toISOString(), source: 'sync' };
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

                if ((appState.google.connected && jaNoGoogle) && (appState.icloud.connected && jaNoICloud)) { debugLog('Já existe nas agendas: ' + phone); continue; }
                if (jaNoGoogle && !appState.icloud.connected) { debugLog('Já existe no Google: ' + phone); continue; }
                if (jaNoICloud && !appState.google.connected) { debugLog('Já existe no iCloud: ' + phone); continue; }

                const name = buildContactName(msg.pushName);
                appState.sequencer.current++;
                await saveSequencer();

                let savedAgenda = false;
                let erroAgenda = null;
                let googleResourceName = null;
                let icloudVcardUrl = null;

                if (appState.google.connected && !jaNoGoogle) {
                    try { googleResourceName = await saveContactToGoogle(phone, name); savedAgenda = true; }
                    catch (e) { erroAgenda = 'Google: ' + e.message; debugLog('Erro Google: ' + e.message); }
                }
                if (appState.icloud.connected && !jaNoICloud) {
                    try { icloudVcardUrl = await saveContactToICloud(phone, name); savedAgenda = true; }
                    catch (e) { erroAgenda = (erroAgenda ? erroAgenda + ' | ' : '') + 'iCloud: ' + e.message; debugLog('Erro iCloud: ' + e.message); }
                }

                const contact = {
                    id: 'contact_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                    phone, name, pushName: msg.pushName || null,
                    pending: false, hasRealPhone: true,
                    savedToAgenda: savedAgenda, erroAgenda: erroAgenda || null,
                    googleResourceName, icloudVcardUrl,
                    detected: new Date().toISOString(), savedAt: new Date().toISOString(),
                    source: 'whatsapp'
                };

                appState.contacts.push(contact);
                await saveContact(contact);
                appState.stats.total++;
                appState.stats.savedToday++;
                log('Novo contato: ' + name + ' (' + phone + ')' + (savedAgenda ? ' ✅' : ' ⚠️'));
                broadcast('contact', contact);
                scheduleAutoReply(jid, phone).catch(e => debugLog('scheduleAutoReply err: ' + e.message));
            }
        });

        return sock;
    } catch (error) {
        log('Erro ao inicializar WhatsApp: ' + error.message, 'error');
        throw error;
    }
}
// =============================================
// AUTO-REPLY COM vCARD
// =============================================
let autoReplyConfig = null;
const pendingReplies = new Map();

async function loadAutoReplyConfig() {
    try {
        const rows = await dbGet('auto_reply_config');
        autoReplyConfig = rows[0] || null;
        debugLog('Auto-reply config carregada: enabled=' + (autoReplyConfig?.enabled || false));
    } catch (e) { debugLog('Erro load auto-reply: ' + e.message); }
}

async function alreadyReplied(phone) {
    try {
        const rows = await dbGet('auto_reply_log', { phone });
        return rows.length > 0;
    } catch (e) { return false; }
}

async function countRepliesToday() {
    try {
        const today = new Date(); today.setHours(0,0,0,0);
        const url = SUPABASE_URL + '/rest/v1/auto_reply_log?select=id&sent_at=gte.' + today.toISOString();
        const r = await axios.get(url, { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } });
        return r.data.length;
    } catch (e) { return 0; }
}

function isWithinHours(cfg) {
    const now = new Date();
    const brtHour = (now.getUTCHours() - 3 + 24) % 24;
    return brtHour >= cfg.hour_start && brtHour < cfg.hour_end;
}

async function scheduleAutoReply(jid, phone) {
    if (!autoReplyConfig || !autoReplyConfig.enabled) return;
    if (!appState.whatsapp.socket) return;
    if (jid.endsWith('@g.us') || jid.endsWith('@broadcast')) return;
    if (!isWithinHours(autoReplyConfig)) { debugLog('Auto-reply: fora do horario, ignorando ' + phone); return; }
    if (await alreadyReplied(phone)) { debugLog('Auto-reply: ja respondeu ' + phone); return; }
    const count = await countRepliesToday();
    if (count >= autoReplyConfig.daily_limit) { debugLog('Auto-reply: limite diario atingido'); return; }

    if (pendingReplies.has(jid)) {
        clearTimeout(pendingReplies.get(jid));
        debugLog('Auto-reply: timer resetado para ' + phone);
    }

    const min = autoReplyConfig.min_delay_sec * 1000;
    const max = autoReplyConfig.max_delay_sec * 1000;
    const delayMs = Math.floor(Math.random() * (max - min + 1)) + min;
    debugLog('Auto-reply: agendado para ' + phone + ' em ' + Math.round(delayMs/1000) + 's');

    const timeoutId = setTimeout(async () => {
        pendingReplies.delete(jid);
        try {
            if (!isWithinHours(autoReplyConfig)) return;
            if (await alreadyReplied(phone)) return;

            const cfg = autoReplyConfig;
            const variations = (cfg.message_variations && cfg.message_variations.length > 0) ? cfg.message_variations : [cfg.message_text];
            const chosenText = variations[Math.floor(Math.random() * variations.length)];

            const phoneClean = cfg.vcard_phone.replace(/\D/g, '');
            const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:' + cfg.vcard_name + '\nORG:' + cfg.vcard_org + '\nTEL;type=CELL;type=VOICE;waid=' + phoneClean + ':' + cfg.vcard_phone + '\nEND:VCARD';

            await appState.whatsapp.socket.sendMessage(jid, { text: chosenText });
            await delay(1500);
            await appState.whatsapp.socket.sendMessage(jid, {
                contacts: {
                    displayName: cfg.vcard_name,
                    contacts: [{ displayName: cfg.vcard_name, vcard }]
                }
            });

            await dbUpsert('auto_reply_log', { phone, sent_at: new Date().toISOString(), status: 'sent' });
            log('Auto-reply enviado: ' + phone);
        } catch (e) {
            debugLog('Erro auto-reply: ' + e.message);
            try { await dbUpsert('auto_reply_log', { phone, sent_at: new Date().toISOString(), status: 'error' }); } catch (_) {}
        }
    }, delayMs);

    pendingReplies.set(jid, timeoutId);
}
// =============================================
// ROTAS
// =============================================
app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/health', (req, res) => { res.json({ status: 'ok', uptime: process.uptime(), mode: 'PRODUCTION', supabase: !!SUPABASE_URL }); });
app.get('/debug/logs', (req, res) => { res.json({ logs: debugLogs, chatsCache: appState.whatsapp.chatsCache?.length || 0 }); });

app.get('/debug/icloud', async (req, res) => {
    const info = {
        connected: appState.icloud.connected,
        appleId: appState.icloud.appleId,
        addressBookUrl: appState.icloud.addressBookUrl,
        lastSync: appState.icloud.lastSync
    };
    if (appState.icloud.connected && appState.icloud.addressBookUrl) {
        try {
            const testResp = await axios({
                method: 'PROPFIND',
                url: appState.icloud.addressBookUrl,
                auth: { username: appState.icloud.appleId, password: appState.icloud.appPassword },
                headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Depth': '0' },
                data: '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:displayname/></D:prop></D:propfind>',
                timeout: 10000,
                validateStatus: () => true
            });
            info.addressBookUrlTest = { status: testResp.status, ok: testResp.status < 300 };
        } catch (e) {
            info.addressBookUrlTest = { status: 'error', message: e.message };
        }
    }
    res.json(info);
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

app.post('/auth/icloud/disconnect', async (req, res) => {
    appState.icloud.connected = false;
    appState.icloud.appleId = null;
    appState.icloud.appPassword = null;
    appState.icloud.addressBookUrl = null;
    await dbUpsert('config', { key: 'icloud_config', value: null, updated_at: new Date().toISOString() }).catch(() => {});
    broadcast('agenda-update', { icloud: false });
    res.json({ ok: true });
});
app.get('/auto-reply/config', async (req, res) => {
    await loadAutoReplyConfig();
    const count = await countRepliesToday();
    res.json({ config: autoReplyConfig, sentToday: count });
});

app.post('/auto-reply/config', async (req, res) => {
    try {
        const b = req.body;
        const payload = { id: 1, updated_at: new Date().toISOString() };
        ['enabled','message_text','message_variations','vcard_name','vcard_phone','vcard_org','hour_start','hour_end','daily_limit','min_delay_sec','max_delay_sec'].forEach(k => {
            if (b[k] !== undefined) payload[k] = b[k];
        });
        await dbUpsert('auto_reply_config', payload);
        await loadAutoReplyConfig();
        res.json({ ok: true, config: autoReplyConfig });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
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
        try { contact.googleResourceName = await saveContactToGoogle(contact.phone, name); } catch (e) { debugLog('Erro Google: ' + e.message); }
    }
    if (appState.icloud.connected && !jaNoICloud) {
        try { contact.icloudVcardUrl = await saveContactToICloud(contact.phone, name); } catch (e) { debugLog('Erro iCloud: ' + e.message); }
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
        if (appState.google.connected && !jaNoGoogle) {
            try { c.googleResourceName = await saveContactToGoogle(c.phone, name); } catch (e) {}
        }
        if (appState.icloud.connected && !jaNoICloud) {
            try { c.icloudVcardUrl = await saveContactToICloud(c.phone, name); } catch (e) {}
        }
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

app.delete('/contacts/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const contact = appState.contacts.find(c => c.id === id || c.phone === id);
        if (!contact) return res.status(404).json({ ok: false, message: 'Contato não encontrado' });
        log('Deletando contato: ' + (contact.name || contact.phone));
        const result = await deleteContactEverywhere(contact);
        broadcast('contact-deleted', { id: contact.id, phone: contact.phone });
        res.json({ ok: true, message: 'Contato deletado', googleOk: result.googleOk, icloudOk: result.icloudOk, errors: result.errors });
    } catch (e) {
        log('Erro ao deletar: ' + e.message, 'error');
        res.status(500).json({ ok: false, error: e.message });
    }
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

// =============================================
// PROCESSAMENTO DE FILA AUTO-REPLY
// =============================================
async function processePendingQueue() {
    try {
        if (!autoReplyConfig || !autoReplyConfig.enabled) return;

        // Se não estamos dentro do horário, não processa
        if (!isWithinHours(autoReplyConfig)) return;

        let processed = 0;
        for (const [jid, timerInfo] of pendingReplies.entries()) {
            // Cancela timer antigo
            clearTimeout(timerInfo);

            // Calcula novo delay aleatório
            const delayMs = Math.random() * (autoReplyConfig.max_delay_sec - autoReplyConfig.min_delay_sec) * 1000
                          + autoReplyConfig.min_delay_sec * 1000;

            // Agenda para envio
            const newTimerId = setTimeout(async () => {
                pendingReplies.delete(jid);
                try {
                    if (!isWithinHours(autoReplyConfig)) return;

                    const phone = jid.replace('@s.whatsapp.net', '');
                    if (await alreadyReplied(phone)) return;

                    const count = await countRepliesToday();
                    if (count >= autoReplyConfig.daily_limit) return;

                    await executeAutoReply(jid, phone);
                    debugLog(`📨 Auto-reply reprocessado para ${phone}`);

                } catch (error) {
                    debugLog('Erro ao reprocessar auto-reply: ' + error.message);
                }
            }, delayMs);

            // Atualiza o timer na fila
            pendingReplies.set(jid, newTimerId);
            processed++;

            debugLog(`📨 Reprocessando fila: ${jid.replace('@s.whatsapp.net', '')} (delay: ${Math.round(delayMs/1000)}s)`);
        }

        if (processed > 0) {
            log(`✅ Fila auto-reply reprocessada: ${processed} mensagens`);
        }

    } catch (error) {
        debugLog('Erro ao processar fila auto-reply: ' + error.message);
    }
}

function initAutoReplyQueueProcessor() {
    // Verificar fila pendente a cada 5 minutos
    setInterval(async () => {
        await processePendingQueue();
    }, 5 * 60 * 1000); // 5 minutos

    log('🔄 Auto-reply queue processor iniciado (verificação a cada 5min)');
}

// =============================================
// INICIALIZAÇÃO — servidor sobe primeiro
// =============================================
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    log('🚀 ContatoSync iniciado na porta ' + PORT);
    setTimeout(async () => {
        await initData();
        initWhatsApp().catch(e => log('Erro ao iniciar WhatsApp: ' + e.message, 'error'));

        // Iniciar verificação da fila de auto-reply
        initAutoReplyQueueProcessor();
    }, 500);
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

process.on('SIGTERM', () => { log('Encerrando...'); process.exit(0); });
process.on('SIGINT', () => { log('Encerrando...'); process.exit(0); });
