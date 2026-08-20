/**
 * Upload release script — creates a GitHub Release for the current version
 * and uploads installer assets (exe + blockmap + latest.yml).
 * Token is read from git credential manager; never printed.
 * Usage: node scripts/upload-release.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OWNER = 'Davidtsoi06';
const REPO = 'personal-finance-app';
const TAG = 'v' + require('../package.json').version;

function getToken() {
  const input = 'protocol=https\nhost=github.com\n\n';
  let out = '';
  try {
    // GCM 的 get 子命令对 stdin 管道的兼容性更好
    out = execSync('git credential-manager get', { input, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
  } catch {
    out = execSync('git credential fill', { input, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
  }
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error('未找到 GitHub 凭据（请先在 git 中完成一次登录）');
  return m[1].trim();
}

/** Extract the release-notes section for the current version from RELEASE_NOTES.md */
function getReleaseBody() {
  const notes = fs.readFileSync(path.join(__dirname, '..', 'RELEASE_NOTES.md'), 'utf8');
  const m = notes.match(new RegExp(`# 个人理财投资软件 ${TAG} 更新说明([\\s\\S]*?)(?=\\n---\\n\\n# |$)`));
  return m ? m[1].trim() : notes;
}

async function main() {
  const token = getToken();
  const auth = { Authorization: 'Bearer ' + token };

  // 1. Create the release（幂等：已存在则复用，支持失败重试）
  const body = getReleaseBody();
  let release;
  const existing = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${TAG}`, {
    headers: { ...auth, 'User-Agent': 'release-script' },
  });
  if (existing.ok) {
    release = await existing.json();
    console.log(`ℹ️ Release ${TAG} 已存在，复用并续传资产: ${release.html_url}`);
  } else {
    const createRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json', 'User-Agent': 'release-script' },
      body: JSON.stringify({ tag_name: TAG, name: TAG, body, draft: false }),
    });
    if (!createRes.ok) {
      const t = await createRes.text();
      throw new Error(`创建 Release 失败 (${createRes.status}): ${t.slice(0, 300)}`);
    }
    release = await createRes.json();
    console.log(`✅ Release ${TAG} 已创建: ${release.html_url}`);
  }

  // 2. Upload assets via curl (more reliable for 100MB+ files than undici fetch)
  const assets = [
    `personal-finance-setup-${require('../package.json').version}.exe`,
    `personal-finance-setup-${require('../package.json').version}.exe.blockmap`,
    'latest.yml',
  ];
  // 查询已有资产，跳过「已完整上传」的同名（幂等续传）
  // v1.10.1 修复：仅 state='uploaded' 才算已存在；'starter'（上传中断的僵尸资产）会被重新上传
  const assetsRes = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?per_page=100`,
    { headers: { ...auth, 'User-Agent': 'release-script' } }
  );
  const existingAssets = assetsRes.ok ? await assetsRes.json() : [];
  const existingNames = new Set(existingAssets.filter((a) => a.state === 'uploaded').map((a) => a.name));

  const respFile = path.join(__dirname, '..', 'release', '_upload_resp.json');
  for (const name of assets) {
    if (existingNames.has(name)) { console.log(`⏭️ 已存在，跳过: ${name}`); continue; }
    const filePath = path.join(__dirname, '..', 'release', name);
    if (!fs.existsSync(filePath)) { console.log(`⚠️ 跳过（不存在）: ${name}`); continue; }
    const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
    const url = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`;
    // -sS 静默但输出错误；-L 跟随 S3 重定向；响应体落盘供解析
    try {
      execSync(
        `curl -sS -L -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/octet-stream" --data-binary @"${filePath.replace(/\\/g, '/')}" "${url}" -o "${respFile.replace(/\\/g, '/')}" -w "HTTP:%{http_code}"`,
        { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 * 1024 }
      );
      console.log(`✅ 已上传 ${name} (${sizeMB} MB)`);
    } catch (err) {
      const stderr = (err && err.stderr) ? String(err.stderr).trim().slice(0, 500) : '';
      const httpMatch = stderr.match(/HTTP:(\d{3})/);
      const status = httpMatch ? Number(httpMatch[1]) : (err && err.status) || 0;
      let body = '';
      try { body = fs.existsSync(respFile) ? fs.readFileSync(respFile, 'utf8').slice(0, 300) : ''; } catch { /* ignore */ }
      if (status === 422 && /already_exists/.test(body)) {
        console.log(`⏭️ 已存在（422），跳过: ${name}`);
        continue;
      }
      throw new Error(`上传 ${name} 失败 (HTTP ${status || '?'}): ${body || stderr}`);
    }
  }
  try { if (fs.existsSync(respFile)) fs.unlinkSync(respFile); } catch { /* ignore */ }
  console.log(`🎉 全部完成: https://github.com/${OWNER}/${REPO}/releases/tag/${TAG}`);
}

main().catch((err) => { console.error('❌', err.message); process.exit(1); });
