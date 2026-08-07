/**
 * Cross-platform Electron starter.
 * Clears ELECTRON_RUN_AS_NODE so Electron runs in browser mode,
 * then spawns the Electron app.
 */
const { spawn } = require('child_process');
const path = require('path');

// Remove the problematic env var
delete process.env.ELECTRON_RUN_AS_NODE;

// Find electron binary
const electronPath = require('electron');
const args = [path.resolve(__dirname, '..')];

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env: process.env, // inherits cleaned env
});

child.on('close', (code) => {
  process.exit(code);
});
