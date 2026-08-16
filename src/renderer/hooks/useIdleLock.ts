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

    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= idleMinutes * 60_000) {
        invoke('auth:lock').catch(() => {});
      }
    }, 30_000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, bump));
      window.clearInterval(timer);
    };
  }, [idleMinutes]);
}