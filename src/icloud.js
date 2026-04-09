'use strict';

/**
 * iCloud Contacts via CardDAV
 * 
 * Apple expõe os contatos via protocolo CardDAV.
 * URL: https://contacts.icloud.com/<dsid>/carddavhome/card/
 * Autenticação: Basic Auth com Apple ID + App-Specific Password
 * 
 * IMPORTANTE: Apple exige "App-Specific Password" para apps de terceiros.
 * O usuário gera em: appleid.apple.com → Segurança → Senhas para apps
 * Isso é obrigatório pela Apple — não há como fazer com a senha normal
 * quando a conta tem 2FA (que é obrigatório em contas Apple modernas).
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const CREDS_FILE = path.resolve('./config/icloud_creds.json');

function saveCredentials(appleId, appPassword) {
  if (!fs.existsSync('./config')) fs.mkdirSync('./config', { recursive: true });
  fs.writeFileSync(CREDS_FILE, JSON.stringify({ appleId, appPassword }, null, 2));
}

function loadCredentials() {
  if (!fs.existsSync(CREDS_FILE)) return null;
  return JSON.parse(fs.readFileSync(CREDS_FILE, 'utf-8'));
}

function isICloudConnected() {
  return fs.existsSync(CREDS_FILE);
}

function disconnectICloud() {
  if (fs.existsSync(CREDS_FILE)) fs.unlinkSync(CREDS_FILE);
}

// Descobre o Principal URL do usuário no CardDAV da Apple
async function discoverPrincipalUrl(appleId, appPassword) {
  const basicAuth = Buffer.from(appleId + ':' + appPassword).toString('base64');
  
  // Apple usa esse endpoint de descoberta
  const res = await fetch('https://contacts.icloud.com/.well-known/carddav', {
    method: 'PROPFIND',
    headers: {
      'Authorization': 'Basic ' + basicAuth,
      'Depth': '0',
      'Content-Type': 'application/xml',
    },
    body: `<?xml version="1.0" encoding="UTF-8"?>
      <d:propfind xmlns:d="DAV:">
        <d:prop>
          <d:current-user-principal/>
        </d:prop>
      </d:propfind>`,
    redirect: 'follow',
  });

  if (res.status === 401) throw new Error('Credenciais inválidas. Verifique o Apple ID e a App-Specific Password.');
  if (!res.ok) throw new Error('Erro ao conectar ao iCloud: ' + res.status);

  const text = await res.text();
  // Extrai o href do principal
  const match = text.match(/<d:href>([^<]+)<\/d:href>/) || text.match(/<href>([^<]+)<\/href>/);
  if (!match) throw new Error('Não foi possível descobrir o endereço CardDAV.');
  
  const href = match[1];
  // Monta URL base
  const base = 'https://contacts.icloud.com';
  return href.startsWith('http') ? href : base + href;
}

// Testa as credenciais e salva se válidas
async function connectICloud(appleId, appPassword) {
  try {
    await discoverPrincipalUrl(appleId, appPassword);
    saveCredentials(appleId, appPassword);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Busca todos os contatos do iCloud e retorna Set de telefones normalizados
async function getICloudPhoneNumbers() {
  const creds = loadCredentials();
  if (!creds) return new Set();
  
  const { appleId, appPassword } = creds;
  const basicAuth = Buffer.from(appleId + ':' + appPassword).toString('base64');
  const saved = new Set();

  try {
    // Busca o endereço do addressbook
    const principalUrl = await discoverPrincipalUrl(appleId, appPassword);
    
    // REPORT para listar todos os contatos com TEL
    const res = await fetch(principalUrl, {
      method: 'REPORT',
      headers: {
        'Authorization': 'Basic ' + basicAuth,
        'Depth': '1',
        'Content-Type': 'application/xml',
      },
      body: `<?xml version="1.0" encoding="UTF-8"?>
        <card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
          <d:prop>
            <card:address-data>
              <card:prop name="TEL"/>
            </card:address-data>
          </d:prop>
        </card:addressbook-query>`,
    });

    const text = await res.text();
    
    // Extrai números TEL do vCard
    const telMatches = text.match(/TEL[^:]*:([^\r\n]+)/g) || [];
    for (const tel of telMatches) {
      const num = tel.split(':')[1];
      if (num) saved.add(num.trim().replace(/[\s\-().]/g, ''));
    }
  } catch (err) {
    console.error('Erro ao buscar contatos iCloud:', err.message);
  }

  return saved;
}

// Salva um contato novo no iCloud via CardDAV
async function saveToICloud(phone, name) {
  const creds = loadCredentials();
  if (!creds) throw new Error('iCloud não conectado');

  const { appleId, appPassword } = creds;
  const basicAuth = Buffer.from(appleId + ':' + appPassword).toString('base64');

  const principalUrl = await discoverPrincipalUrl(appleId, appPassword);
  const uid = 'contatosync-' + Date.now() + '-' + Math.random().toString(36).slice(2);

  // Monta o vCard 3.0
  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'UID:' + uid,
    'FN:' + name,
    'N:' + name + ';;;;',
    'TEL;TYPE=CELL:' + phone,
    'END:VCARD',
  ].join('\r\n');

  const cardUrl = principalUrl.replace(/\/?$/, '/') + uid + '.vcf';
  console.log('[iCloud] Salvando:', name, '→', cardUrl);

  const res = await fetch(cardUrl, {
    method: 'PUT',
    headers: {
      'Authorization': 'Basic ' + basicAuth,
      'Content-Type': 'text/vcard; charset=utf-8',
    },
    body: vcard,
  });

  console.log('[iCloud] Resposta PUT:', res.status, res.statusText);
  const responseBody = await res.text();
  if (responseBody) console.log('[iCloud] Body:', responseBody);

  if (!res.ok && res.status !== 201 && res.status !== 204) {
    throw new Error('Erro ao salvar contato no iCloud: ' + res.status);
  }

  // Verificar se realmente foi salvo
  const checkRes = await fetch(cardUrl, {
    method: 'GET',
    headers: { 'Authorization': 'Basic ' + basicAuth }
  });

  console.log('[iCloud] Verificação GET:', checkRes.status);
  if (checkRes.ok) {
    const savedVcard = await checkRes.text();
    console.log('[iCloud] Contato confirmado no servidor:', name);
  } else {
    console.log('[iCloud] AVISO: Contato não encontrado após salvar:', name, '- Status:', checkRes.status);
  }

  return { uid, name, phone, cardUrl };
}

module.exports = {
  connectICloud,
  isICloudConnected,
  disconnectICloud,
  getICloudPhoneNumbers,
  saveToICloud,
  loadCredentials,
};
