import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import yazl from 'yazl';
import { exportPackage, importPackage, isSqliteBuffer } from '../../src/main/services/data-package';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** 用 yazl 造一个含指定 finance.db 内容的 .pfbak */
function makePackage(outPath: string, dbContent: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(dbContent, 'finance.db');
    const out = fs.createWriteStream(outPath);
    out.on('close', () => resolve());
    out.on('error', (e) => reject(e));
    zip.outputStream.pipe(out);
    zip.end();
  });
}

function realDbBuffer(): Buffer {
  const f = tmpDir('pfbak-src-');
  const p = path.join(f, 'real.db');
  const db = new Database(p);
  db.exec('CREATE TABLE t (x TEXT)');
  db.prepare('INSERT INTO t VALUES (?)').run('hello');
  db.close();
  const buf = fs.readFileSync(p);
  fs.rmSync(f, { recursive: true, force: true });
  return buf;
}

describe('数据包导入/导出（v1.9.1 WAL 修复）', () => {
  it('isSqliteBuffer：合法库文件头通过，垃圾数据拒绝', () => {
    const good = realDbBuffer();
    expect(isSqliteBuffer(good)).toBe(true);
    expect(isSqliteBuffer(Buffer.from('这不是数据库'))).toBe(false);
    expect(isSqliteBuffer(Buffer.alloc(100, 0))).toBe(false);
  });

  it('导出：在线备份自洽快照（WAL 内容并入），解包后可正常打开', async () => {
    const dir = tmpDir('pfbak-export-');
    const dbPath = path.join(dir, 'finance.db');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS demo (id INTEGER PRIMARY KEY, name TEXT)');
    const ins = db.prepare('INSERT INTO demo (name) VALUES (?)');
    for (let i = 0; i < 50; i++) ins.run('row-' + i);
    // 写 WAL 数据（不 checkpoint，模拟用户正常使用状态）
    const out = path.join(dir, 'pkg.pfbak');
    await exportPackage(dir, out, '1.9.1', db);
    db.close();

    expect(fs.existsSync(out)).toBe(true);
    // 解包验证：finance.db 自洽、数据完整
    const yauzl = require('yauzl') as typeof import('yauzl');
    const bufs = new Map<string, Buffer>();
    await new Promise<void>((resolve, reject) => {
      yauzl.open(out, { lazyEntries: true }, (err, zip) => {
        if (err || !zip) { reject(err); return; }
        zip.readEntry();
        zip.on('entry', (entry) => {
          zip.openReadStream(entry, (e2, stream) => {
            if (e2) { reject(e2); return; }
            const chunks: Buffer[] = [];
            stream.on('data', (c) => chunks.push(c));
            stream.on('end', () => { bufs.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
          });
        });
        zip.on('end', () => resolve());
        zip.on('error', reject);
      });
    });
    const dbBuf = bufs.get('finance.db')!;
    expect(isSqliteBuffer(dbBuf)).toBe(true);
    const checkPath = path.join(dir, 'check.db');
    fs.writeFileSync(checkPath, dbBuf);
    const chk = new Database(checkPath, { readonly: true });
    expect((chk.prepare('SELECT COUNT(*) as c FROM demo').get() as any).c).toBe(50);
    chk.close();
    // 临时快照已清理
    expect(fs.readdirSync(dir).some((f) => f.startsWith('finance-export-tmp'))).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('导入：替换库文件 + 清理残留 wal/shm，旧数据备份自洽', async () => {
    const dir = tmpDir('pfbak-import-');
    // 现有旧库（连接打开中 + 残留 wal/shm 垃圾文件——模拟旧版本崩溃残留）
    const dbPath = path.join(dir, 'finance.db');
    const oldDb = new Database(dbPath);
    oldDb.exec('CREATE TABLE IF NOT EXISTS old_data (v TEXT)');
    oldDb.prepare('INSERT INTO old_data VALUES (?)').run('old-value');
    fs.writeFileSync(dbPath + '-wal', 'GARBAGE-WAL-CONTENT');
    fs.writeFileSync(dbPath + '-shm', 'GARBAGE-SHM-CONTENT');

    // 新库内容（模拟来自另一台设备导出的包）
    const newDbBuf = (() => {
      const f = tmpDir('pfbak-new-');
      const p = path.join(f, 'new.db');
      const ndb = new Database(p);
      ndb.exec('CREATE TABLE IF NOT EXISTS new_data (v TEXT)');
      ndb.prepare('INSERT INTO new_data VALUES (?)').run('new-value');
      ndb.close();
      const b = fs.readFileSync(p);
      fs.rmSync(f, { recursive: true, force: true });
      return b;
    })();
    const pkg = path.join(dir, 'in.pfbak');
    await makePackage(pkg, newDbBuf);

    const backupPath = await importPackage(dir, pkg, oldDb, {
      close: () => { try { oldDb.close(); } catch { /* 已关闭 */ } },
      reopen: null,
    });

    // 残留 wal/shm 已删除
    expect(fs.existsSync(dbPath + '-wal')).toBe(false);
    expect(fs.existsSync(dbPath + '-shm')).toBe(false);
    // 新库内容生效
    const verify = new Database(dbPath, { readonly: true });
    expect((verify.prepare('SELECT v FROM new_data').get() as any).v).toBe('new-value');
    verify.close();
    // 备份存在且含旧数据（自洽可恢复）
    expect(backupPath).toBeTruthy();
    const bak = new Database(backupPath!, { readonly: true });
    expect((bak.prepare('SELECT v FROM old_data').get() as any).v).toBe('old-value');
    bak.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('导入坏包（非 SQLite 内容）：拒绝且原库不被覆盖', async () => {
    const dir = tmpDir('pfbak-bad-');
    const dbPath = path.join(dir, 'finance.db');
    const oldDb = new Database(dbPath);
    oldDb.exec('CREATE TABLE IF NOT EXISTS keep (v TEXT)');
    oldDb.prepare('INSERT INTO keep VALUES (?)').run('keep-me');

    const pkg = path.join(dir, 'bad.pfbak');
    await makePackage(pkg, Buffer.from('NOT-A-SQLITE-DB'));

    await expect(
      importPackage(dir, pkg, oldDb, {
        close: () => { try { oldDb.close(); } catch { /* 已关闭 */ } },
        reopen: null,
      })
    ).rejects.toThrow(/无效/);

    // 原库完好
    const chk = new Database(dbPath, { readonly: true });
    expect((chk.prepare('SELECT v FROM keep').get() as any).v).toBe('keep-me');
    chk.close();
    try { oldDb.close(); } catch { /* 已关闭 */ }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('导出→导入 完整往返：数据一致且导入后可直接打开', async () => {
    const dirA = tmpDir('pfbak-a-');
    const dirB = tmpDir('pfbak-b-');
    // A 端：真实库 + WAL 数据
    const dbA = new Database(path.join(dirA, 'finance.db'));
    dbA.pragma('journal_mode = WAL');
    dbA.exec('CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY, note TEXT)');
    for (let i = 0; i < 20; i++) dbA.prepare('INSERT INTO ledger (note) VALUES (?)').run('n' + i);
    const pkg = path.join(dirA, 'out.pfbak');
    await exportPackage(dirA, pkg, '1.9.1', dbA);

    // B 端：已有旧库 + 残留 wal（模拟旧版本崩溃残留）
    const dbB = new Database(path.join(dirB, 'finance.db'));
    dbB.exec('CREATE TABLE IF NOT EXISTS stale (v TEXT)');
    fs.writeFileSync(path.join(dirB, 'finance.db-wal'), 'STALE');

    await importPackage(dirB, pkg, dbB, {
      close: () => { try { dbB.close(); } catch { /* 已关闭 */ } },
      reopen: null,
    });
    dbA.close();

    // B 端新库 = A 端数据（往返一致）
    const verify = new Database(path.join(dirB, 'finance.db'), { readonly: true });
    expect((verify.prepare('SELECT COUNT(*) as c FROM ledger').get() as any).c).toBe(20);
    verify.close();
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  });
});
