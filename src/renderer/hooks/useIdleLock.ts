import { useEffect, useRef } from 'react';
import { invoke } from './useIpc';

/**
 * useIdleLock — 空闲自动锁定（v1.7.0）。
 * 主窗口内无输入活动超过 idleMinutes 分钟后调用 auth:lock（主进程隐藏主窗、显示锁屏）。
 */
export function useIdleLock(idleMinutes: number | null | undefined): void {
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    if (!idleMinutes || idleMinutes < 1) return;
    lastActivity.current = Date.now();

    const bump = () => { lastActivity.current = Date.now(); };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));

    let timer: ReturnType<typeof setInterval> | null = null;
    let hidden = document.hidden;

    const stopTimer = () => { if (timer) { window.clearInterval(timer); timer = null; } };
    const startTimer = () => {
      if (timer || hidden) return;
      timer = window.setInterval(() => {
        if (Date.now() - lastActivity.current >= idleMinutes * 60_000) {
          invoke('auth:lock').catch(() => {});
        }
      }, 30_000);
    };

    // v1.10.19：窗口隐藏（锁屏/最小化）期间停止空闲计时——
    // 此前主窗渲染进程在锁屏期间持续 tick 且 lastActivity 停留在旧值，
    // 解锁恢复可见后下一次 tick 会立即误判超时再次锁定（表现：输密码→闪退→又回锁屏）
    const onVisibility = () => {
      if (document.hidden) {
        hidden = true;
        stopTimer();
      } else {
        hidden = false;
        lastActivity.current = Date.now(); // 解锁/恢复可见：重置空闲起点
        startTimer();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    startTimer();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      events.forEach((ev) => window.removeEventListener(ev, bump));
      stopTimer();
    };
  }, [idleMinutes]);
}