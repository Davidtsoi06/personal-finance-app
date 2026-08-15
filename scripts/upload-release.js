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
  const out = execSync('git credential fill', {
    input: 'protocol=https\nhost=github.com\n\n',
    stdio: ['pipe', 'pipe', 'ignore'],
  }).toString();
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error('未找到 GitHub 凭据');
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

  // 1. Create the release
  const body = getReleaseBody();
  const createRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json', 'User-Agent': 'release-script' },
    body: JSON.stringify({ tag_name: TAG, name: TAG, body, draft: false }),
  });
  if (!createRes.ok) {
    const t = await createRes.text();
    throw new Error(`创建 Release 失败 (${createRes.status}): ${t.slice(0, 300)}`);
  }
  const release = await createRes.json();
  console.log(`✅ Release ${TAG} 已创建: ${release.html_url}`);

  // 2. Upload assets via curl (more reliable for 100MB+ files than undici fetch)
  const assets = [
    `personal-finance-setup-${require('../package.json').version}.exe`,
    `personal-finance-setup-${require('../package.json').version}.exe.blockmap`,
    'latest.yml',
  ];
  for (const name of assets) {
    const filePath = path.join(__dirname, '..', 'release', name);
    if (!fs.existsSync(filePath)) { console.log(`⚠️ 跳过（不存在）: ${name}`); continue; }
    const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
    const url = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`;
    execSync(
      `curl -s -f -X POST -H "Authorization: Bearer ${token}" -H "Content-Type: application/octet-stream" --data-binary @"${filePath.replace(/\\/g, '/')}" "${url}" -o /dev/null`,
      { stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 1024 * 1024 }
    );
    console.log(`✅ 已上传 ${name} (${sizeMB} MB)`);
  }
  console.log(`🎉 全部完成: https://github.com/${OWNER}/${REPO}/releases/tag/${TAG}`);
}

main().catch((err) => { console.error('❌', err.message); process.exit(1); });
