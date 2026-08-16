/**
 * IPC 入参运行时校验包装器（zod）——渲染进程传错类型/缺字段时在边界拒绝，防止脏数据落库。
 * schema 定义在 src/shared/ipc-validation.ts（可单元测试）。
 */
import { ipcMain } from 'electron';
import { z } from 'zod';
import { SCHEMAS } from '../../shared/ipc-validation';
import { assertUnlocked } from '../services/auth-service';

/**
 * 注册带 zod 校验的 IPC handler：校验失败抛出错误（渲染进程 catch 后展示），
 * 校验通过则以解析后的参数调用 handler（不再传入 event）。
 */
export function handleValidated(
  channel: string,
  handler: (...args: any[]) => unknown
): void {
  const schema = SCHEMAS[channel];
  if (!schema) throw new Error('未定义校验 schema: ' + channel);
  ipcMain.handle(channel, (_event, ...args: unknown[]) => {
    // 启动密码锁门禁（v1.7.0）：未解锁时拒绝一切非 auth 频道（auth 频道自身放行）
    try {
      assertUnlocked(channel);
    } catch (gateErr: any) {
      throw new Error(gateErr?.message || '应用已锁定');
    }
    const parsed = (schema as z.ZodTypeAny).safeParse(args);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 3)
        .map((i) => i.path.join('.') + '：' + i.message)
        .join('；');
      console.error('[IPC校验] ' + channel + ' 参数不合法 → ' + detail);
      throw new Error('参数校验失败（' + channel + '）：' + detail);
    }
    return handler(...(parsed.data as unknown[]));
  });
}
