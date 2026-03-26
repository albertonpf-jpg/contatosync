'use strict';

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
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
let reconnectTimer = null;
let isStarting = false;

// Mapa LID -> numero real, populado pelo evento contacts.upsert
const lidToPhone = new Map();

// Buffer de logs para debug via /debug/logs
let debugLogs = [];
function debugLog(msg) {
  const entry = '[' + new Date().toISOString() + '] ' + msg;
  console.log(entry);
  debugLogs.push(entry);
  if (debugLogs.length > 200) debugLogs.shift();
}
function getDebugLogs() { return debugLogs; }

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Verifica se JID e de pessoa (nao grupo, nao broadcast)
function isPersonJid(jid) {
  if (!jid) return false;
  if (jid.endsWith('@g.us')) return false;
  if (jid.endsWith('@broadcast')) return false;
  return true;
}

// Extrai numero de um JID @s.whatsapp.net
function jidToPhone(jid) {
  if (!jid) return null;
  const raw = jid.split('@')[0].split(':')[0];
  if (/^\d{7,15}$/.test(raw)) return '+' + raw;
  return null;
}

// Resolve o numero real a partir do JID (incluindo LID)
function resolvePhone(jid) {
  if (!jid) return null;

  // 1) JID normal com numero real
  const direct = jidToPhone(jid);
  if (direct) return direct;

  // 2) LID mapeado via contacts.upsert
  if (lidToPhone.has(jid)) return lidToPhone.get(jid);

  // 3) Nao resolvido
  return null;
}

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

async function saveToAgendas(phone, name) {
  const results = { google: null, icloud: null, errors: [] };
  if (isGoogleConnected()) {
    try { results.google = await saveToGoogle(phone, name); }
    catch (e) { results.errors.push('Google: ' + e.message); }
  }
  if (isICloudConnected()) {
    try { results.icloud = await saveToICloud(phone, name); }
    catch (e) { results.errors.push('iCloud: ' + e.message); }
  }
  if (!isGoogleConnected() && !isICloudConnected()) {
    throw new Error('Nenhuma agenda conectada.');
  }
  return results;
}

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
  const normalized = phone.replace(/\D/g, '');
  if (savedToday.find((c) => c.phone.replace(/\D/g, '') === normalized)) return null;
  if (knownNumbers.has(normalized) || knownNumbers.has('+' + normalized)) return null;

  const name = nextContactName();
  try {
    await saveToAgendas(phone, name);
    knownNumbers.add(normalized);
    const contact = { phone, name, source, savedAt: new Date().toISOString() };
    savedToday.push(contact);
    pendingContacts = pendingContacts.filter((c) => c.phone !== phone);
    debugLog('SALVO: ' + name + ' (' + phone + ') [' + source + ']');
    return contact;
  } catch (err) {
    debugLog('ERRO ao salvar ' + phone + ': ' + err.message);
    return null;
  }
}

function addPending(phone, name) {
  const normalized = phone.replace(/\D/g, '');
  if (
    !pendingContacts.find((c) => c.phone.replace(/\D/g, '') === normalized) &&
    !savedToday.find((c) => c.phone.replace(/\D/g, '') === normalized) &&
    !knownNumbers.has(normalized)
  ) {
    pendingContacts.push({ phone, name: name || null, pending: true, detectedAt: new Date().toISOString() });
  }
}

async function syncHistory() {
  debugLog('Carregando numeros conhecidos das agendas...');
  try {
    knownNumbers = await loadKnownNumbers();
    debugLog(knownNumbers.size + ' numeros ja salvos nas agendas');
  } catch (err) {
    debugLog('Erro ao carregar numeros: ' + err.message);
  }
}

async function startWhatsApp(onQR, onConnected, onDisconnected, onNewContact) {
  if (isStarting) return;
  isStarting = true;

  const { state, saveCreds } = await useMultiFileAuthState('./config/baileys_auth');
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    browser: ['ContatoSync', 'Chrome', '120.0.0'],
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrCodeData = qr;
      connectionStatus = 'connecting';
      qrcodeTerminal.generate(qr, { small: true });
      debugLog('QR Code gerado');
      onQR && onQR(qr);
    }
    if (connection === 'open') {
      qrCodeData = null;
      connectionStatus = 'connected';
      isStarting = false;
      debugLog('WhatsApp conectado!');
      onConnected && onConnected();
      syncHistory();
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      connectionStatus = 'disconnected';
      qrCodeData = null;
      isStarting = false;
      debugLog('Conexao fechada. code=' + code);
      onDisconnected && onDisconnected(code);
      if (code !== DisconnectReason.loggedOut) {
        debugLog('Reconectando em 5s...');
        reconnectTimer = setTimeout(() => startWhatsApp(onQR, onConnected, onDisconnected, onNewContact), 5000);
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // EVENTO CHAVE: mapeia LID -> numero real quando o Baileys sincroniza contatos
  sock.ev.on('contacts.upsert', (contacts) => {
    for (const c of contacts) {
      if (!c.id) continue;
      // Se o proprio ID tem numero real
      const phoneFromId = jidToPhone(c.id);
      if (phoneFromId) {
        // Guardar tambem mapeamento reverso por notify/name se houver
        continue;
      }
      // Se e um LID, tentar pegar numero de outros campos
      if (c.id.endsWith('@lid')) {
        // O Baileys as vezes popula c.notify com o numero ou nome
        if (c.notify && /^\+?\d{7,15}$/.test(c.notify.replace(/\D/g, ''))) {
          const phone = '+' + c.notify.replace(/\D/g, '');
          lidToPhone.set(c.id, phone);
          debugLog('LID mapeado: ' + c.id + ' -> ' + phone);
        }
        // Logar o que chegou para debug
        debugLog('contacts.upsert LID=' + c.id + ' notify=' + c.notify + ' name=' + c.name + ' fields=' + Object.keys(c).join(','));
      }
    }
  });

  // Tambem captura atualizacoes de contatos
  sock.ev.on('contacts.update', (updates) => {
    for (const c of updates) {
      if (!c.id) continue;
      if (c.id.endsWith('@lid')) {
        debugLog('contacts.update LID=' + c.id + ' fields=' + Object.keys(c).join(',') + ' data=' + JSON.stringify(c));
        if (c.notify && /^\d{7,15}$/.test(c.notify.replace(/\D/g, ''))) {
          const phone = '+' + c.notify.replace(/\D/g, '');
          lidToPhone.set(c.id, phone);
          debugLog('LID atualizado: ' + c.id + ' -> ' + phone);
        }
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const jid = msg.key.remoteJid;
      if (!jid) continue;
      if (!isPersonJid(jid)) continue;
      if (msg.key.fromMe) continue;

      debugLog('MSG de: ' + jid + ' | pushName: ' + (msg.pushName || 'null'));

      // Tentar resolver numero real
      let phone = resolvePhone(jid);

      if (!phone) {
        // Tentar via pushName se parecer numero
        const pn = (msg.pushName || '').replace(/\D/g, '');
        if (pn.length >= 10 && pn.length <= 13) {
          phone = '+' + pn;
          debugLog('Numero extraido do pushName: ' + phone);
        }
      }

      if (!phone) {
        debugLog('Numero nao resolvido para: ' + jid + ' | LID map size: ' + lidToPhone.size + ' | Aguardando contacts.upsert...');
        // Adicionar como pendente com o LID temporariamente
        addPending(jid, msg.pushName || null);
        onNewContact && onNewContact({ phone: jid, name: msg.pushName, pending: true, isLid: true });
        continue;
      }

      const normalized = phone.replace(/\D/g, '');
      if (knownNumbers.has(normalized)) { debugLog('Ja salvo na agenda: ' + phone); continue; }
      if (savedToday.find((c) => c.phone.replace(/\D/g, '') === normalized)) { debugLog('Ja salvo hoje: ' + phone); continue; }

      debugLog('Novo numero detectado: ' + phone);

      if (autoSaveEnabled) {
        const saved = await trySaveContact(phone, 'auto');
        if (saved) onNewContact && onNewContact(saved);
      } else {
        addPending(phone, msg.pushName || null);
        onNewContact && onNewContact({ phone, name: msg.pushName, pending: true });
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
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (sock) {
    try { sock.logout(); } catch(e) {}
    sock = null;
    connectionStatus = 'disconnected';
  }
}

module.exports = { startWhatsApp, getStatus, setAutoSave, saveContactManually, saveAllPending, disconnect, getDebugLogs };
