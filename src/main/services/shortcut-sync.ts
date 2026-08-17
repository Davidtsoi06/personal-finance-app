/**
 * shortcut-sync — Windows 快捷方式名称同步（v1.8.1）。
 * 修改应用名称后，把桌面与开始菜单中指向本应用的 .lnk 重命名为新名称。
 * 通过 PowerShell + WScript.Shell COM 实现；失败不阻断（返回 0 并记录日志）。
 */
import { execFile } from 'child_process';

/** 生成 PowerShell 脚本（纯函数，可测试；newName 单引号转义防注入） */
export function buildShortcutSyncScript(targetPath: string, newName: string): string {
  const escapedName = newName.replace(/'/g, "''");
  const lines = [
    '$ErrorActionPreference = \'SilentlyContinue\'',
    '$sh = New-Object -ComObject WScript.Shell',
    `$target = '${targetPath.replace(/'/g, "''")}'`,
    `$newName = '${escapedName}'`,
    '$count = 0',
    '$dirs = @([Environment]::GetFolderPath(\'Desktop\'), [Environment]::GetFolderPath(\'StartMenu\'), "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs")',
    'foreach ($dir in $dirs) {',
    '  if (Test-Path $dir) {',
    '    Get-ChildItem -Path $dir -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {',
    '      $lnk = $sh.CreateShortcut($_.FullName)',
    '      if ($lnk.TargetPath -eq $target -and $_.BaseName -ne $newName) {',
    '        Rename-Item -Path $_.FullName -NewName ($newName + \'.lnk\') -ErrorAction SilentlyContinue',
    '        if ($?) { $count++ }',
    '      }',
    '    }',
    '  }',
    '}',
    'Write-Output $count',
  ];
  return lines.join('\n');
}

/** 同步快捷方式名称，返回重命名数量（失败返回 0） */
export function syncShortcutNames(targetPath: string, newName: string): Promise<number> {
  return new Promise((resolve) => {
    const script = buildShortcutSyncScript(targetPath, newName);
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 15000 }, (err, stdout) => {
      if (err) {
        console.warn('[shortcut-sync] 同步失败（非致命）:', err.message);
        resolve(0);
        return;
      }
      const n = parseInt((stdout || '').trim(), 10);
      resolve(Number.isFinite(n) ? n : 0);
    });
  });
}