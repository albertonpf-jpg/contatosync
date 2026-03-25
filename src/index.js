'use strict';
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Static files with fallback
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.static(__dirname)); // Serve from src too

// Main route with detailed error handling
app.get('/', (req, res) => {
  const frontendPath = path.join(__dirname, '../frontend');
  const indexPath = path.join(frontendPath, 'index.html');
  
  // Check if frontend directory exists
  if (!fs.existsSync(frontendPath)) {
    return res.send(`
      <html><body style="font-family:Arial;padding:20px;background:#0a0a0a;color:white;">
      <h1 style="color:#25d366;">🚀 ContatoSync Online!</h1>
      <p>Servidor funcionando. Frontend em configuração...</p>
      <p><a href="/test.html" style="color:#25d366;">Ver teste</a> | <a href="/health" style="color:#25d366;">Health</a></p>
      <p style="color:#666; font-size:12px;">Frontend path: ${frontendPath}</p>
      </body></html>
    `);
  }
  
  // Try to serve index.html
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.log('Error serving index:', err.message);
      res.send(`
        <html><body style="font-family:Arial;padding:20px;background:#0a0a0a;color:white;">
        <h1 style="color:#25d366;">🚀 ContatoSync Quase Pronto!</h1>
        <p>Servidor online, carregando interface...</p>
        <p><a href="/test.html" style="color:#25d366;">Ver teste</a> | <a href="/health" style="color:#25d366;">Health</a></p>
        </body></html>
      `);
    }
  });
});

// Simple fallback for all other routes
app.get('*', (req, res) => {
  res.status(404).send(`
    <html><body style="font-family:Arial;padding:20px;background:#0a0a0a;color:white;">
    <h1>ContatoSync - 404</h1>
    <p><a href="/" style="color:#25d366;">← Voltar ao início</a></p>
    </body></html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 ContatoSync rodando na porta ${PORT}`);
});
