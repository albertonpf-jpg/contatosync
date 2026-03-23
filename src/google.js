'use strict';

/**
 * Google Contacts via OAuth2
 *
 * Usa as credenciais de um app Google pré-cadastrado (ContatoSync).
 * O usuário clica em "Conectar Google", faz login com e-mail e senha
 * no próprio Google, autoriza, e pronto — sem configurar nada.
 *
 * Para publicar o produto, cadastre uma vez em:
 *   console.cloud.google.com → People API → OAuth Consent Screen
 * e coloque o Client ID e Secret no .env.
 * Seus clientes nunca precisam fazer isso.
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.resolve('./config/google_token.json');
const SCOPES = ['https://www.googleapis.com/auth/contacts'];

function getOAuthClient() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET não configurados no .env');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

// URL que abre o login Google no navegador do usuário
function getGoogleAuthUrl() {
  const auth = getOAuthClient();
  return auth.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

// Chamado após o usuário autorizar — troca code por token e salva
async function handleGoogleCallback(code) {
  const auth = getOAuthClient();
  const { tokens } = await auth.getToken(code);
  auth.setCredentials(tokens);
  if (!fs.existsSync('./config')) fs.mkdirSync('./config', { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
  return tokens;
}

function getAuthenticatedClient() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
  const auth = getOAuthClient();
  auth.setCredentials(tokens);
  return auth;
}

function isGoogleConnected() {
  return fs.existsSync(TOKEN_FILE);
}

function disconnectGoogle() {
  if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
}

// Salva um contato no Google Contacts
async function saveToGoogle(phone, name) {
  const auth = getAuthenticatedClient();
  if (!auth) throw new Error('Google Contacts não conectado');
  const people = google.people({ version: 'v1', auth });
  const response = await people.people.createContact({
    requestBody: {
      names: [{ givenName: name }],
      phoneNumbers: [{ value: phone, type: 'mobile' }],
    },
  });
  return response.data;
}

// Retorna Set com todos os telefones já salvos no Google
async function getGooglePhoneNumbers() {
  const auth = getAuthenticatedClient();
  if (!auth) return new Set();
  const people = google.people({ version: 'v1', auth });
  const saved = new Set();
  let pageToken;
  do {
    const res = await people.people.connections.list({
      resourceName: 'people/me',
      pageSize: 1000,
      personFields: 'phoneNumbers',
      pageToken,
    });
    for (const person of res.data.connections || []) {
      for (const p of person.phoneNumbers || []) {
        saved.add(p.value.replace(/[\s\-().]/g, ''));
      }
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return saved;
}

module.exports = {
  getGoogleAuthUrl,
  handleGoogleCallback,
  getAuthenticatedClient,
  isGoogleConnected,
  disconnectGoogle,
  saveToGoogle,
  getGooglePhoneNumbers,
};
