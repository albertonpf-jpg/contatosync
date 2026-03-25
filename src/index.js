'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Mock functions para os módulos que não existem ainda
const mockWhatsAppModule = {
  startWhatsApp: () => Promise.reject(new Error('WhatsApp módulo não carregado')),
  getStatus: () => ({ connected: false, qr: null, phone: null }),
  setAutoSave: () => {},
  saveContactManually: () => Promise.resolve(null),
  saveAllPending: () => Promise.resolve([]),
  disconnect: () => {}
};

const mockGoogleModule = {
  getGoogleAuthUrl: () => { throw new Error('Google OAuth não configurado'); },
  handleGoogleCallback: () => Promise.reject(new Error('Google OAuth não configurado')),
  isGoogleConnected: () => false,
  disconnectGoogle: () => {}
};

const mockICloudModule = {
  connectICloud: () => Promise.resolve({ ok: false, error: 'iCloud não configurado' }),
  isICloudConnected: () => false,
  disconnectICloud: () => {}
};

const mockSequencerModule = {
  getSequencerState: () => ({ prefix: 'Contato Zap', nextNumber: 1 }),
  updateSequencer: (data) => ({ ...data })
};

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Static files with fallback
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.static(__dirname));

// Main route
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, '../frontend/index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.send(`
        <html><body style="font-family:Arial;padding:20px;background:#0a0a0a;color:white;">
        <h1 style="color:#25d366;">🚀 ContatoSync Online!</h1>
        <p>Interface carregando...</p>
        <p><a href="/test.html" style="color:#25d366;">Ver teste</a></p>
        </body></html>
      `);
    }
  });
});

// Mock API endpoints para manter a interface funcionando
app.get('/whatsapp/status', (req, res) => res.json(mockWhatsAppModule.getStatus()));
app.post('/whatsapp/connect', (req, res) => {
  res.status(500).json({ ok: false, error: 'WhatsApp módulo em configuração' });
});
app.post('/whatsapp/disconnect', (req, res) => res.json({ ok: true }));

app.get('/google/status', (req, res) => res.json({ connected: mockGoogleModule.isGoogleConnected() }));
app.get('/icloud/status', (req, res) => res.json({ connected: mockICloudModule.isICloudConnected() }));
app.get('/sequencer', (req, res) => res.json(mockSequencerModule.getSequencerState()));

// SSE endpoint
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.write('event: status\ndata: ' + JSON.stringify({ connected: false }) + '\n\n');
});

// Fallback
app.get('*', (req, res) => {
  res.status(404).send(`
    <html><body style="font-family:Arial;padding:20px;background:#0a0a0a;color:white;">
    <h1>404</h1><p><a href="/" style="color:#25d366;">← Início</a></p>
    </body></html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 ContatoSync rodando na porta ${PORT}`);
});
