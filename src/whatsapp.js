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

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

function onlyDigits(value) {
  if (!value) return '';
  return String(value).replace(/\D/g, '');
}

function normalizeStoredPhone(phone) {
  const digits = onlyDigits(phone);
  return digits || null;
}

function normalizePhone(jid) {
  if (!jid || typeof jid !== 'string') return null;

  const raw = jid.split('@')[0].split(':')[0];
  const digits = onlyDigits(raw);

  if (!digits) return null;

  return '+' + digits;
}

function isPersonJid(jid) {
  if (!jid || typeof jid !== 'string') return false;
  if (jid.endsWith('@g.us')) return false;
  if (jid.endsWith('@broadcast')) return false;
  if (jid.endsWith('@s.whatsapp.net')) return true;
  if (jid.endsWith('@lid')) return true;
  return false;
}

function getRealPhone(msg) {
  if (!msg || !msg.key) return null;

  const candidates = [
    msg.key.remoteJid,
    msg.key.participant,
    msg.participant,
    msg.sender,
    msg.senderPn,
    msg.participantPn,
    msg.pushName,
    msg.verifiedBizAccount
  ];

  for (const candidate of candidates) {
    const phone = normalizePhone(candidate);
    if (phone) return phone;
  }

  return null;
}

function safeStringify(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return '[erro ao serializar payload]';
  }
}

function logLidPayload(msg) {
  try {
    console.log('================ LID PAYLOAD START ================');
    console.log('remoteJid:', msg?.key?.remoteJid || null);
    console.log('participant:', msg?.key?.participant || msg?.participant || null);
    console.log('pushName:', msg?.pushName || null);
    console.log('sender:', msg?.sender || null);
    console.log('senderPn:', msg?.senderPn || null);
    console.log('participantPn:', msg?.participantPn || null);
    console.log('verifiedBizAccount:', msg?.verifiedBizAccount || null);
    console.log('mensagem completa:');
    console.log(safeStringify(msg));
    console.log('================= LID PAYLOAD END =================');
  } catch (e) {
    console.log('Erro ao logar payload LID:', e.message);
  }
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

function setAutoSave(enabled) {
  autoSaveEnabled = !!enabled;
}

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

async function loadKnownNumbers() {
  const all = new Set();

  const [gNums, iNums] = await Promise.all([
    isGoogleConnected() ? getGooglePhoneNumbers() : Promise.resolve(new Set()),
    isICloudConnected() ? getICloudPhoneNumbers() : Promise.resolve(new Set()),
  ]);

  gNums.forEach((n) => {
    const normalized = normalizeStoredPhone(n);
    if (normalized) all.add(normalized);
  });

  iNums.forEach((n) => {
    const normalized = normalizeStoredPhone(n);
    if (normalized) all.add(normalized);
  });

  return all;
}

async function trySaveContact(phone, source) {
  source = source || 'manual';

  const normalized = normalizeStoredPhone(phone);
  if (!normalized) return null;

  if (savedToday.find((c) => normalizeStoredPhone(c.phone) === normalized)) return null;
  if (knownNumbers.has(normalized)) return null;

  const name = nextContactName();

  try {
    await saveToAgendas(phone, name);
    knownNumbers.add(normalized);

    const contact = {
      phone,
      name,
      source,
      savedAt: new Date().toISOString()
    };

    savedToday.push(contact);
    pendingContacts = pendingContacts.filter((c) => normalizeStoredPhone(c.phone) !== normalized);

    console.log('✅ Salvo: ' + name + ' (' + phone + ') [' + source + ']');
    return contact;
  } catch (err) {
    console.error('❌ Erro ao salvar ' + phone + ':', err.message);
    return null;
  }
}

function addPending(phone) {
  const normalized = normalizeStoredPhone(phone);
  if (!normalized) return;

  const alreadyPending = pendingContacts.find((c) => normalizeStoredPhone(c.phone) === normalized);
  const alreadySavedToday = savedToday.find((c) => normalizeStoredPhone(c.phone) === normalized);
  const alreadyKnown = knownNumbers.has(normalized);

  if (!alreadyPending && !alreadySavedToday && !alreadyKnown) {
    pendingContacts.push({
      phone,
      detectedAt: new Date().toISOString()
    });
  }
}

async function syncHistory(socket) {
  console.log('🔄 Sincronizando histórico...');
  const batchSize = parseInt(process.env.BATCH_SIZE || '10', 10);
  const batchDelay = parseInt(process.env.BATCH_DELAY_MS || '2000', 10);

  try {
    knownNumbers = await loadKnownNumbers();
    console.log('📋 ' + knownNumbers.size + ' números já salvos nas agendas');

    const chats = await socket.groupFetchAllParticipating();
    const allJids = Object.keys(chats);
    let processed = 0;

    for (let i = 0; i < allJids.length; i += batchSize) {
      const batch = allJids.slice(i, i + batchSize);

      for (const jid of batch) {
        if (isPersonJid(jid)) {
          const phone = normalizePhone(jid);
          if (phone) addPending(phone);
        }
        processed++;
      }

      console.log('🔄 ' + processed + '/' + allJids.length);

      if (i + batchSize < allJids.length) {
        await delay(batchDelay);
      }
    }

    console.log('✅ Sincronização concluída — ' + pendingContacts.length + ' sem nome');
  } catch (err) {
    console.error('Erro na sincronização:', err.message);
  }
}

async function startWhatsApp(onQR, onConnected, onDisconnected, onNewContact) {
  if (isStarting) {
    console.log('⏳ Inicialização do WhatsApp já está em andamento.');
    return;
  }

  isStarting = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState('./config/baileys_auth');
    const { version } = await fetchLatestBaileysVersion();

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

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
        console.log('📲 QR Code recebido, aguardando leitura...');
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
        const code =
          lastDisconnect &&
          lastDisconnect.error &&
          lastDisconnect.error.output &&
          lastDisconnect.error.output.statusCode;

        connectionStatus = 'disconnected';
        qrCodeData = null;

        console.log('❌ Conexão fechada');
        console.log('📌 Status code:', code);
        console.log('📌 Mensagem do erro:', lastDisconnect?.error?.message || 'sem mensagem');
        console.log('📌 Nome do erro:', lastDisconnect?.error?.name || 'sem nome');

        onDisconnected && onDisconnected(code);

        if (code !== DisconnectReason.loggedOut) {
          console.log('🔁 Reconectando em 3s...');
          reconnectTimer = setTimeout(() => {
            startWhatsApp(onQR, onConnected, onDisconnected, onNewContact);
          }, 3000);
        } else {
          console.log('🚪 Sessão deslogada. Reconexão automática cancelada.');
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        const jid = msg?.key?.remoteJid;
        if (!jid) continue;
        if (!isPersonJid(jid)) continue;
        if (msg.key.fromMe) continue;

        const isLid = typeof jid === 'string' && jid.endsWith('@lid');
        const phone = getRealPhone(msg);

        if (isLid) {
          console.log('⚠️ Mensagem recebida com @lid');
          logLidPayload(msg);
        }

        if (!phone) {
          console.log('⚠️ Não foi possível extrair número real de:', jid);
          continue;
        }

        const normalized = normalizeStoredPhone(phone);
        if (!normalized) continue;
        if (knownNumbers.has(normalized)) continue;
        if (savedToday.find((c) => normalizeStoredPhone(c.phone) === normalized)) continue;

        console.log('📩 Nova mensagem de: ' + phone + ' (jid: ' + jid + ')');

        if (autoSaveEnabled) {
          const saved = await trySaveContact(phone, 'auto');
          if (saved) onNewContact && onNewContact(saved);
        } else {
          addPending(phone);
          onNewContact && onNewContact({ phone, pending: true });
        }
      }
    });
  } finally {
    isStarting = false;
  }
}

async function saveContactManually(phone) {
  return trySaveContact(phone, 'manual');
}

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
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (sock) {
    sock.logout();
    sock = null;
    connectionStatus = 'disconnected';
    qrCodeData = null;
  }
}

module.exports = {
  startWhatsApp,
  getStatus,
  setAutoSave,
  saveContactManually,
  saveAllPending,
  disconnect
};
