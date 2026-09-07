/**
 * electron-access — Electron 主进程能力惰性访问（可测试）。
 * 函数内 require('electron')：非 Electron 环境（vitest/node 直载）返回 null 不抛错；
 * vitest 通过 vi.mock 本模块即可注入受控值。
 */

/** appData 路径（%APPDATA%）；非 Electron 环境返回 null */
export function getAppDataPath(): string | null {
  try {
    const { app } = require('electron') as typeof import('electron');
    const p = app?.getPath?.('appData');
    return typeof p === 'string' && p ? p : null;
  } catch {
    return null;
  }
}

/** 应用版本（package.json version，Electron 提供）；非 Electron 环境返回 null */
export function getAppVersionValue(): string | null {
  try {
    const { app } = require('electron') as typeof import('electron');
    const v = app?.getVersion?.();
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}