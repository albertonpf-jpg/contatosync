'use strict';
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const qrcodeTerminal = require('qrcode-terminal');
const pino = require('pino');
const { nextContactName } = require('./sequencer.js');
const { isGoogleConnected, saveToGoogle, getGooglePhoneNumbers } = require('./google.js');
const { isICloudConnected, saveToICloud, getICloudPhoneNumbers } = require('./icloud.js');

const logger = pino({ level: 'silent' });

let sock = null;
let qrCodeData = null;
let connectionStatus = 'disconnected';
let autoSaveEnabled = true;
let savedToday = [];
let pendingContacts = [];
let knownNumbers = new Set();

function normalizePhone(jid) {
  return '+' + jid.replace('@s.whatsapp.net', '').replace('@g.us', '');
}
function isPersonJid(jid) {
  return jid && jid.endsWith('@s.whatsapp.net');
}
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

function getStatus() {
  return {
    status: connectionStatus,
    qr: qrCodeData,
    autoSave: autoSaveEnabled,
    savedToday: savedToday.length,
    pending: pendingContacts.length,
    pendingContacts,
    savedContacts: savedToday,
    googleConnected: isGoogleConnected(),
    icloudConnected: isICloudConnected(),
  };
}

function setAutoSave(enabled) { autoSaveEnabled = enabled; }

// Salva nas agendas ativas (Google e/ou iCloud)
async function saveToAgendas(phone, name) {
  const results = { google: null, icloud: null, errors: [] };

  if (isGoogleConnected()) {
    try {
      results.google = await saveToGoogle(phone, name);
    } catch (e) {
      results.errors.push('Google: ' + e.message);
    }
  }

  if (isICloudConnected()) {
    try {
      results.icloud = await saveToICloud(phone, name);
    } catch (e) {
      results.errors.push('iCloud: ' + e.message);
    }
  }

  if (!isGoogleConnected() && !isICloudConnected()) {
    throw new Error('Nenhuma agenda conectada. Conecte o Google ou iCloud primeiro.');
  }

  return results;
}

// Carrega números já salvos de todas as agendas conectadas
async function loadKnownNumbers() {
  const all = new Set();
  const [gNums, iNums] = await Promise.all([
    isGoogleConnected() ? getGooglePhoneNumbers() : Promise.resolve(new Set()),
    isICloudConnected() ? getICloudPhoneNumbers() : Promise.resolve(new Set()),
  ]);
  gNums.forEach(n => all.add(n));
  iNums.forEach(n => all.add(n));
  return all;
}

async function trySaveContact(phone, source) {
  source = source || 'manual';
  const normalized = phone.replace(/[\s\-().]/g, '');
  if (savedToday.find((c) => c.phone === normalized)) return null;
  if (knownNumbers.has(normalized)) return null;

  const name = nextContactName();
  try {
    await saveToAgendas(phone, name);
    knownNumbers.add(normalized);
    const contact = { phone: normalized, name, source, savedAt: new Date().toISOString() };
    savedToday.push(contact);
    pendingContacts = pendingContacts.filter((c) => c.phone !== normalized);
    console.log('✅ Salvo: ' + name + ' (' + phone + ') [' + source + ']');
    return contact;
  } catch (err) {
    console.error('❌ Erro ao salvar ' + phone + ':', err.message);
    return null;
  }
}

function addPending(phone) {
  const normalized = phone.replace(/[\s\-().]/g, '');
  if (
    !pendingContacts.find((c) => c.phone === normalized) &&
    !savedToday.find((c) => c.phone === normalized) &&
    !knownNumbers.has(normalized)
  ) {
    pendingContacts.push({ phone: normalized, detectedAt: new Date().toISOString() });
  }
}

async function syncHistory(socket) {
  console.log('🔄 Sincronizando histórico...');
  const batchSize = parseInt(process.env.BATCH_SIZE || '10');
  const batchDelay = parseInt(process.env.BATCH_DELAY_MS || '2000');
  try {
    knownNumbers = await loadKnownNumbers();
    console.log('📋 ' + knownNumbers.size + ' números já salvos nas agendas');
    const chats = await socket.groupFetchAllParticipating();
    const allJids = Object.keys(chats);
    let processed = 0;
    for (let i = 0; i < allJids.length; i += batchSize) {
      const batch = allJids.slice(i, i + batchSize);
      for (const jid of batch) {
        if (isPersonJid(jid)) addPending(normalizePhone(jid));
        processed++;
      }
      console.log('🔄 ' + processed + '/' + allJids.length);
      if (i + batchSize < allJids.length) await delay(batchDelay);
    }
    console.log('✅ Sincronização concluída — ' + pendingContacts.length + ' sem nome');
  } catch (err) {
    console.error('Erro na sincronização:', err.message);
  }
}

async function startWhatsApp(onQR, onConnected, onDisconnected, onNewContact) {
  const { state, saveCreds } = await useMultiFileAuthState('./config/baileys_auth');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version, logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrCodeData = qr;
      connectionStatus = 'connecting';
      qrcodeTerminal.generate(qr, { small: true });
      onQR && onQR(qr);
    }
    if (connection === 'open') {
      qrCodeData = null;
      connectionStatus = 'connected';
      console.log('✅ WhatsApp conectado!');
      onConnected && onConnected();
      syncHistory(sock);
    }
    if (connection === 'close') {
      const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;
      connectionStatus = 'disconnected';
      qrCodeData = null;
      onDisconnected && onDisconnected(code);
      if (code !== DisconnectReason.loggedOut) {
        console.log('🔁 Reconectando em 3s...');
        setTimeout(() => startWhatsApp(onQR, onConnected, onDisconnected, onNewContact), 3000);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const jid = msg.key.remoteJid;
      if (!jid || !isPersonJid(jid)) continue;
      if (msg.key.fromMe) continue;
      const phone = normalizePhone(jid);
      const normalized = phone.replace(/[\s\-().]/g, '');
      if (knownNumbers.has(normalized)) continue;
      if (savedToday.find((c) => c.phone === normalized)) continue;
      console.log('📩 Nova mensagem de: ' + phone);
      if (autoSaveEnabled) {
        const saved = await trySaveContact(phone, 'auto');
        if (saved) onNewContact && onNewContact(saved);
      } else {
        addPending(phone);
        onNewContact && onNewContact({ phone: normalized, pending: true });
      }
    }
  });
}

async function saveContactManually(phone) { return trySaveContact(phone, 'manual'); }
async function saveAllPending() {
  const results = [];
  for (const c of [...pendingContacts]) {
    const saved = await trySaveContact(c.phone, 'manual');
    if (saved) results.push(saved);
    await delay(300);
  }
  return results;
}
function disconnect() {
  if (sock) { sock.logout(); sock = null; connectionStatus = 'disconnected'; }
}

module.exports = { startWhatsApp, getStatus, setAutoSave, saveContactManually, saveAllPending, disconnect };
