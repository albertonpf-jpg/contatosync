'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const open = require('open').default || require('open');

const { startWhatsApp, getStatus, setAutoSave, saveContactManually, saveAllPending, disconnect } = require('./whatsapp.js');
const { getGoogleAuthUrl, handleGoogleCallback, isGoogleConnected, disconnectGoogle } = require('./google.js');
const { connectICloud, isICloudConnected, disconnectICloud } = require('./icloud.js');
const { getSequencerState, updateSequencer } = require('./sequencer.js');

const app = express();
app.use(cors());
app.use(express.json());

// ── Frontend estático ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

// ── SSE ───────────────────────────────────────────────────────────
const sseClients = [];
function broadcast(event, data) {
  const payload = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  sseClients.forEach((r) => r.write(payload));
}
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.push(res);
  res.write('event: status\ndata: ' + JSON.stringify(getStatus()) + '\n\n');
  req.on('close', () => { const i = sseClients.indexOf(res); if (i > -1) sseClients.splice(i, 1); });
});

// ── WhatsApp ──────────────────────────────────────────────────────
app.post('/whatsapp/connect', async (req, res) => {
  try {
    await startWhatsApp(
      (qr) => broadcast('qr', { qr }),
      () => broadcast('connected', getStatus()),
      (code) => broadcast('disconnected', { code }),
      (contact) => broadcast('contact', contact)
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.get('/whatsapp/status', (req, res) => res.json(getStatus()));
app.post('/whatsapp/disconnect', (req, res) => { disconnect(); res.json({ ok: true }); });
app.post('/whatsapp/auto-save', (req, res) => {
  setAutoSave(req.body.enabled);
  broadcast('settings', { autoSave: req.body.enabled });
  res.json({ ok: true, autoSave: req.body.enabled });
});

// ── Contatos ──────────────────────────────────────────────────────
app.post('/contacts/save', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: 'phone obrigatório' });
  try {
    const result = await saveContactManually(phone);
    if (result) { broadcast('contact', result); res.json({ ok: true, contact: result }); }
    else res.json({ ok: false, message: 'Contato já salvo' });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});
app.post('/contacts/save-all', async (req, res) => {
  try {
    const results = await saveAllPending();
    results.forEach((c) => broadcast('contact', c));
    res.json({ ok: true, saved: results.length, contacts: results });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

// ── Sequenciador ──────────────────────────────────────────────────
app.get('/sequencer', (req, res) => res.json(getSequencerState()));
app.put('/sequencer', (req, res) => {
  const updated = updateSequencer(req.body);
  res.json({ ok: true, ...updated });
});

// ── Google Contacts ───────────────────────────────────────────────
app.get('/google/status', (req, res) => res.json({ connected: isGoogleConnected() }));

// Inicia login Google — abre navegador automaticamente
app.get('/auth/google', (req, res) => {
  try {
    const url = getGoogleAuthUrl();
    res.redirect(url);
  } catch (err) {
    res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:2rem;background:#0a0a0a;color:#fff">
        <h2 style="color:#e05252">❌ Google não configurado</h2>
        <p style="color:#999">Adicione GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no arquivo .env</p>
        <p style="color:#555;margin-top:1rem;font-size:13px">${err.message}</p>
      </body></html>
    `);
  }
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    await handleGoogleCallback(req.query.code);
    broadcast('agenda-update', { google: true });
    res.send(`
      <html><body style="font-family:sans-serif;padding:2rem;background:#0a0a0a;color:#fff;text-align:center">
        <h2 style="color:#25d366">✅ Google Contacts conectado!</h2>
        <p style="color:#999">Pode fechar esta aba e voltar ao ContatoSync.</p>
        <script>setTimeout(()=>window.close(),2000)</script>
      </body></html>
    `);
  } catch (err) { res.status(500).send('Erro: ' + err.message); }
});

app.post('/auth/google/disconnect', (req, res) => {
  disconnectGoogle();
  broadcast('agenda-update', { google: false });
  res.json({ ok: true });
});

// ── iCloud Contacts ───────────────────────────────────────────────
app.get('/icloud/status', (req, res) => res.json({ connected: isICloudConnected() }));

// Login iCloud com Apple ID + App-Specific Password
app.post('/auth/icloud', async (req, res) => {
  const { appleId, appPassword } = req.body;
  if (!appleId || !appPassword) return res.status(400).json({ ok: false, error: 'Apple ID e senha obrigatórios' });
  try {
    const result = await connectICloud(appleId, appPassword);
    if (result.ok) {
      broadcast('agenda-update', { icloud: true });
      res.json({ ok: true, message: 'iCloud conectado com sucesso!' });
    } else {
      res.status(401).json({ ok: false, error: result.error });
    }
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.post('/auth/icloud/disconnect', (req, res) => {
  disconnectICloud();
  broadcast('agenda-update', { icloud: false });
  res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const url = 'http://localhost:' + PORT;
  console.log('\n  ╔══════════════════════════════════════╗');
  console.log('  ║        ContatoSync — v1.0            ║');
  console.log('  ║   🌐 ' + url + '          ║');
  console.log('  ╚══════════════════════════════════════╝\n');
  // Abre o navegador automaticamente
  open(url).catch(() => {});
});
