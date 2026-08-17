/**
 * data-package — 完整数据包导出/导入（v1.8.1，跨设备迁移）。
 * .pfbak = zip(finance.db, secret.key, manifest.json)。
 */
import fs from 'fs';
import path from 'path';
import yazl from 'yazl';
import yauzl from 'yauzl';


export interface PackageManifest {
  app: string;
  version: string;
  exportedAt: string;
}

/** 导出完整数据包到目标路径（含数据库与加密密钥；密钥仅在启用过敏感功能时存在） */
export function exportPackage(userDataDir: string, outPath: string, version: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const dbPath = path.join(userDataDir, 'finance.db');
    const keyPath = path.join(userDataDir, 'secret.key');
    if (!fs.existsSync(dbPath)) {
      reject(new Error('未找到数据库文件'));
      return;
    }

    const manifest: PackageManifest = {
      app: 'personal-finance',
      version,
      exportedAt: new Date().toISOString(),
    };

    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), 'manifest.json');
    zip.addFile(dbPath, 'finance.db');
    if (fs.existsSync(keyPath)) zip.addFile(keyPath, 'secret.key');
    const out = fs.createWriteStream(outPath);
    out.on('close', () => resolve());
    out.on('error', (e) => reject(e));
    zip.outputStream.pipe(out);
    zip.end();
  });
}

/** 解包并覆盖到用户数据目录（先备份现有数据库）。返回备份路径或 null。 */
export function importPackage(userDataDir: string, inPath: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    yauzl.open(inPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) { reject(new Error('无法打开数据包：文件损坏或格式不正确')); return; }

      const entries = new Map<string, Buffer>();
      zip.readEntry();
      zip.on('entry', (entry: yauzl.Entry) => {
        if (/^\//.test(entry.fileName)) { zip.readEntry(); return; }
        zip.openReadStream(entry, (e2, stream) => {
          if (e2) { reject(e2); return; }
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => {
        const dbBuf = entries.get('finance.db');
        if (!dbBuf) { reject(new Error('数据包缺少数据库文件')); return; }
        try {
          // 备份现有数据库（迁移安全）
          let backupPath: string | null = null;
          const dbPath = path.join(userDataDir, 'finance.db');
          if (fs.existsSync(dbPath)) {
            const backupsDir = path.join(userDataDir, 'backups');
            fs.mkdirSync(backupsDir, { recursive: true });
            backupPath = path.join(backupsDir, 'finance-pre-import-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db');
            fs.copyFileSync(dbPath, backupPath);
          }
          fs.writeFileSync(dbPath, dbBuf);
          const keyBuf = entries.get('secret.key');
          if (keyBuf) fs.writeFileSync(path.join(userDataDir, 'secret.key'), keyBuf);
          resolve(backupPath);
        } catch (e: any) {
          reject(e);
        }
      });
      zip.on('error', (e) => reject(e));
    });
  });
}