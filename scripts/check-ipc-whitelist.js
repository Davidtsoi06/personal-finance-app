#!/usr/bin/env node
/**
 * IPC 频道一致性校验（npm test 自动执行）：
 *   1. 主进程 ipcMain.handle() 注册（单一事实来源）
 *   2. src/main/preload.ts 白名单 ALLOWED_INVOKE_CHANNELS
 *   3. src/shared/types/ipc.ts 类型联合 IpcChannel
 * 三者必须完全一致，不一致退出码 1。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function extractMainChannels() {
  const channels = new Set();
  for (const file of walk(path.join(root, 'src/main'))) {
    const text = fs.readFileSync(file, 'utf8');
    // 两种注册方式：ipcMain.handle('...') 与 handleValidated('...')（zod 校验包装）
    for (const re of [
      /ipcMain\.handle\(\s*['"]([^'"]+)['"]/g,
      /handleValidated\(\s*['"]([^'"]+)['"]/g,
    ]) {
      let m;
      while ((m = re.exec(text))) channels.add(m[1]);
    }
  }
  return [...channels].sort();
}

/** shared/ipc-validation.ts 中定义的 SCHEMAS 键（channel → z.tuple） */
function extractSchemaChannels() {
  const file = path.join(root, 'src/shared/ipc-validation.ts');
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const channels = new Set();
  const re = /^\s*'([a-z][a-zA-Z0-9]+:[a-zA-Z0-9]+)':\s*z\.tuple/gm;
  let m;
  while ((m = re.exec(text))) channels.add(m[1]);
  return [...channels].sort();
}

/** handleValidated 调用点（已接入校验的注册） */
function extractValidatedRegistrations() {
  const channels = new Set();
  for (const file of walk(path.join(root, 'src/main'))) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /handleValidated\(\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = re.exec(text))) channels.add(m[1]);
  }
  return [...channels].sort();
}

function extractPreloadChannels() {
  const text = fs.readFileSync(path.join(root, 'src/main/preload.ts'), 'utf8');
  const start = text.indexOf('const ALLOWED_INVOKE_CHANNELS = new Set<string>(');
  const open = text.indexOf('[', start);
  const close = text.indexOf(']);', open);
  if (start < 0 || open < 0 || close < 0) {
    console.error('[check-ipc] 无法定位 preload.ts 中的白名单块');
    process.exit(1);
  }
  const block = text.slice(open + 1, close);
  const channels = new Set();
  const re = /'([a-z][a-zA-Z0-9]+:[a-zA-Z0-9]+)'/g;
  let m;
  while ((m = re.exec(block))) channels.add(m[1]);
  return [...channels].sort();
}

function extractTypeChannels() {
  const text = fs.readFileSync(path.join(root, 'src/shared/types/ipc.ts'), 'utf8');
  const channels = new Set();
  const re = /\|\s*'([a-z][a-zA-Z0-9]+:[a-zA-Z0-9]+)'/g;
  let m;
  while ((m = re.exec(text))) channels.add(m[1]);
  return [...channels].sort();
}

function diff(name, a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  const onlyA = [...sa].filter((x) => !sb.has(x));
  const onlyB = [...sb].filter((x) => !sa.has(x));
  if (onlyA.length || onlyB.length) {
    console.error('[check-ipc] 不一致: ' + name);
    if (onlyA.length) console.error('   缺少: ' + onlyA.join(', '));
    if (onlyB.length) console.error('   多余: ' + onlyB.join(', '));
    return false;
  }
  return true;
}

const main = extractMainChannels();
const preload = extractPreloadChannels();
const types = extractTypeChannels();
const schemaChannels = extractSchemaChannels();
const validated = extractValidatedRegistrations();

let ok = true;
ok = diff('主进程 ↔ preload 白名单', main, preload) && ok;
ok = diff('主进程 ↔ shared/types/ipc.ts', main, types) && ok;
// validation.ts 中定义了 schema 但未通过 handleValidated 接入的频道（会导致校验永不生效）
const schemaOnly = schemaChannels.filter((c) => !validated.includes(c));
if (schemaOnly.length) {
  console.error('[check-ipc] 定义了校验 schema 但未接入 handleValidated: ' + schemaOnly.join(', '));
  ok = false;
}
// handleValidated 注册了但未定义 schema 的频道（启动时会直接抛错）
const validatedOnly = validated.filter((c) => !schemaChannels.includes(c));
if (validatedOnly.length) {
  console.error('[check-ipc] handleValidated 注册但缺少 schema: ' + validatedOnly.join(', '));
  ok = false;
}

if (!ok) {
  console.error('[check-ipc] 请同步三处频道列表（主进程注册 / preload 白名单 / shared 类型联合）后重试。');
  process.exit(1);
}
console.log('[check-ipc] 三处一致（' + main.length + ' 个频道）');
