'use strict';
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.resolve('./config/sequence.json');

function loadState() {
  if (!fs.existsSync('./config')) fs.mkdirSync('./config', { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    const initial = {
      prefix: process.env.CONTACT_PREFIX || 'Contato Zap',
      current: parseInt(process.env.CONTACT_SEQ_START || '1'),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function nextContactName() {
  const state = loadState();
  const name = state.prefix + ' ' + state.current;
  state.current += 1;
  saveState(state);
  return name;
}

function updateSequencer({ prefix, current }) {
  const state = loadState();
  if (prefix !== undefined) state.prefix = prefix;
  if (current !== undefined) state.current = parseInt(current);
  saveState(state);
  return state;
}

function getSequencerState() {
  return loadState();
}

module.exports = { nextContactName, updateSequencer, getSequencerState };
