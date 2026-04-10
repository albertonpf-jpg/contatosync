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
