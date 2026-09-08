import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MIGRATIONS } from '../../src/main/database/migrations';
import { setDatabaseForTest } from '../../src/main/database';

// mock electron-access：appData → 每测试临时目录；version → 固定测试值
const mockAppData = vi.hoisted(() => ({ dir: '' }));
vi.mock('../../src/main/services/electron-access', () => ({
  getAppDataPath: () => mockAppData.dir || null,
  getAppVersionValue: () => '9.9.9-test',
}));

// mock settings-service：内存 map（不落库）
const mockSettings = vi.hoisted(() => {
  const map = new Map<string, string>();
  return {
    map,
    getSetting: (k: string) => map.get(k) ?? null,
    setSetting: (k: string, v: string) => { map.set(k, v); },
  };
});
vi.mock('../../src/main/database/services/settings-service', () => ({
  getSetting: (k: string) => mockSettings.getSetting(k),
  setSetting: (k: string, v: string) => mockSettings.setSetting(k, v),
}));

import { ensureAutoLinked, getPortfolioStatus, detectAIDataDir } from '../../src/main/services/ai-portfolio-service';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))");
  for (const m of MIGRATIONS) {
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      if (m.migrate && m.version !== 13) m.migrate(db);
      db.prepare('INSERT INTO _migrations (version) VALUES (?)').run(m.version);
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
  }
  setDatabaseForTest(db);
  return db;
}

function aiPortfolioFolder(): string {
  return path.join(mockAppData.dir, 'ai-investment-analyst', 'data', 'portfolio');
}

describe('AI 持仓快照自动关联（v1.10.18）', () => {
  let db: Database.Database;
  let tmpRoot: string;

  beforeEach(() => {
    db = freshDb();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-portfolio-autolink-'));
    mockAppData.dir = tmpRoot;
    mockSettings.map.clear();
  });

  afterEach(() => {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    db.close();
  });

  it('已配置且目录存在 → manual，不覆盖、不触发导出', () => {
    const manualDir = path.join(tmpRoot, 'manual-folder');
    fs.mkdirSync(manualDir, { recursive: true });
    mockSettings.map.set('aiPortfolio.folder', manualDir);
    const r = ensureAutoLinked();
    expect(r.mode).toBe('manual');
    expect(r.folder).toBe(manualDir);
    expect(mockSettings.map.get('aiPortfolio.folder')).toBe(manualDir); // 不被覆盖
    // v1.10.19：manual 启动也会刷新一次快照（保证 AI 侧最新），但路径不被改写
    expect(fs.existsSync(path.join(manualDir, 'portfolio_snapshot.json'))).toBe(true);
  });

  it('已配置但目录不存在（换电脑模拟）→ auto：重设 folder + 自动导出文件', () => {
    mockSettings.map.set('aiPortfolio.folder', path.join(tmpRoot, 'gone-folder')); // 已失效
    fs.mkdirSync(aiPortfolioFolder(), { recursive: true }); // AI 数据目录存在
    const r = ensureAutoLinked();
    expect(r.mode).toBe('auto');
    const saved = mockSettings.map.get('aiPortfolio.folder') || '';
    expect(saved).toBe(aiPortfolioFolder());
    // 自动导出真实写文件
    expect(fs.existsSync(path.join(aiPortfolioFolder(), 'portfolio_snapshot.json'))).toBe(true);
  });

  it('未配置 + 探测命中 → auto + 导出文件', () => {
    fs.mkdirSync(aiPortfolioFolder(), { recursive: true });
    const r = ensureAutoLinked();
    expect(r.mode).toBe('auto');
    expect(r.detected).toBe(true);
    expect(fs.existsSync(path.join(aiPortfolioFolder(), 'portfolio_snapshot.json'))).toBe(true);
    const data = JSON.parse(fs.readFileSync(path.join(aiPortfolioFolder(), 'portfolio_snapshot.json'), 'utf-8'));
    expect(data.version).toBe('9.9.9-test'); // mock getAppVersionValue
  });

  it('未配置 + 未探测到 → none，不写设置、不导出', () => {
    const r = ensureAutoLinked();
    expect(r.mode).toBe('none');
    expect(r.detected).toBe(false);
    expect(mockSettings.map.has('aiPortfolio.folder')).toBe(false);
  });

  it('getPortfolioStatus 纯查询：不写设置、不导出', () => {
    fs.mkdirSync(aiPortfolioFolder(), { recursive: true });
    const s = getPortfolioStatus();
    expect(s.mode).toBe('auto');
    expect(s.folder).toBe(aiPortfolioFolder());
    expect(mockSettings.map.has('aiPortfolio.folder')).toBe(false);
    expect(fs.existsSync(path.join(aiPortfolioFolder(), 'portfolio_snapshot.json'))).toBe(false);
  });

  it('detectAIDataDir：无 AI 目录返回 null；弱判据（仅空 data）不命中', () => {
    expect(detectAIDataDir()).toBeNull();
    // 空 data 目录（无 portfolio/db/secret.key）不命中
    fs.mkdirSync(path.join(tmpRoot, 'ai-investment-analyst', 'data'), { recursive: true });
    expect(detectAIDataDir()).toBeNull();
    // 有 portfolio 子目录 → 命中
    fs.mkdirSync(aiPortfolioFolder(), { recursive: true });
    expect(detectAIDataDir()).toBe(path.join(tmpRoot, 'ai-investment-analyst', 'data'));
  });
});