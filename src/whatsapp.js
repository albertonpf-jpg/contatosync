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

// Extrai número real do JID — suporta @s.whatsapp.net, @lid e @g.us
function normalizePhone(jid) {
    if (!jid) return null;
    // Remove sufixo e qualquer parte após ":"
  const raw = jid.split('@')[0].split(':')[0];
    // Só aceita se for numérico (número de telefone real)
  if (/^\d+$/.test(raw)) {
        return '+' + raw;
  }
    return null;
}

// Verifica se é JID de pessoa individual (aceita @s.whatsapp.net e @lid)
function isPersonJid(jid) {
    if (!jid) return false;
    if (jid.endsWith('@g.us')) return false; // grupo
  if (jid.endsWith('@broadcast')) return false; // broadcast
  if (jid.endsWith('@s.whatsapp.net')) return true;
    if (jid.endsWith('@lid')) return true;
    return false;
}

// Tenta obter o número real a partir da mensagem completa
// O Baileys em modo LID armazena o número real em msg.key.participant ou msg.verifiedBizAccount
function getRealPhone(msg) {
    const jid = msg.key.remoteJid;

  // 1) Tentar extrair do JID principal
  const fromJid = normalizePhone(jid);
    if (fromJid) return fromJid;

  // 2) Tentar msg.key.participant (usado em grupos e alguns LID)
  if (msg.key.participant) {
        const fromParticipant = normalizePhone(msg.key.participant);
        if (fromParticipant) return fromParticipant;
  }

  // 3) Tentar campos extras da mensagem
  if (msg.verifiedBizAccount) {
        const fromBiz = normalizePhone(msg.verifiedBizAccount);
        if (fromBiz) return fromBiz;
  }

  // 4) Se não conseguiu número real, retorna null (vai ser ignorado)
  return null;
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

function setAutoSave(enabled) {
    autoSaveEnabled = enabled;
}

// Salva nas agendas ativas (Google e/ou iCloud)
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
    const normalized = phone.replace(/[\s\-().+]/g, '');
    if (savedToday.find((c) => c.phone.replace(/[\s\-().+]/g, '') === normalized)) return null;
    if (knownNumbers.has(normalized) || knownNumbers.has('+' + normalized)) return null;

  const name = nextContactName();
    try {
          await saveToAgendas(phone, name);
          knownNumbers.add(normalized);
          const contact = { phone, name, source, savedAt: new Date().toISOString() };
          savedToday.push(contact);
          pendingContacts = pendingContacts.filter((c) => c.phone !== phone);
          console.log('✅ Salvo: ' + name + ' (' + phone + ') [' + source + ']');
          return contact;
    } catch (err) {
          console.error('❌ Erro ao salvar ' + phone + ':', err.message);
          return null;
    }
}

function addPending(phone) {
    const normalized = phone.replace(/[\s\-().+]/g, '');
    if (
          !pendingContacts.find((c) => c.phone.replace(/[\s\-().+]/g, '') === normalized) &&
          !savedToday.find((c) => c.phone.replace(/[\s\-().+]/g, '') === normalized) &&
          !knownNumbers.has(normalized)
        ) {
          pendingContacts.push({ phone, detectedAt: new Date().toISOString() });
    }
}

async function syncHistory(socket) {
    console.log('🔄 Sincronizando histórico.');
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
                            if (isPersonJid(jid)) {
                                        const phone = normalizePhone(jid);
                                        if (phone) addPending(phone);
                            }
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
                const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;
                connectionStatus = 'disconnected';
                qrCodeData = null;
                console.log('❌ Conexão fechada');
                onDisconnected && onDisconnected(code);
                if (code !== DisconnectReason.loggedOut) {
                          console.log('🔁 Reconectando em 3s...');
                          setTimeout(() => startWhatsApp(onQR, onConnected, onDisconnected, onNewContact), 3000);
                } else {
                          console.log('🚪 Sessão deslogada. Reconexão automática cancelada.');
                }
        }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
                const jid = msg.key.remoteJid;
                if (!jid) continue;
                if (!isPersonJid(jid)) continue;
                if (msg.key.fromMe) continue;

          // Extrair número real — suporta @s.whatsapp.net e @lid
          const phone = getRealPhone(msg);
                if (!phone) {
                          console.log('⚠️ Não foi possível extrair número real de:', jid);
                          continue;
                }

          const normalized = phone.replace(/[\s\-().+]/g, '');
                if (knownNumbers.has(normalized)) continue;
                if (savedToday.find((c) => c.phone.replace(/[\s\-().+]/g, '') === normalized)) continue;

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
    if (sock) {
          sock.logout();
          sock = null;
          connectionStatus = 'disconnected';
    }
}

module.exports = { startWhatsApp, getStatus, setAutoSave, saveContactManually, saveAllPending, disconnect };
