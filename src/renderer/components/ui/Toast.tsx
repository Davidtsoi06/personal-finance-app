/**
 * Toast — 全局轻提示（v1.8.0 操作后撤销体系）。
 * 用法：const { showToast } = useToast();
 *   showToast('已创建定期存款', '撤销', async () => { ... });
 */
import { createContext, useContext, useState, useCallback, useRef } from 'react';

export interface ToastItem {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}

interface ToastContextValue {
  showToast: (message: string, actionLabel?: string, onAction?: () => void | Promise<void>) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, actionLabel?: string, onAction?: () => void | Promise<void>) => {
    const id = ++idRef.current;
    setToasts((list) => [...list, { id, message, actionLabel, onAction }]);
    window.setTimeout(() => remove(id), 5000);
  }, [remove]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div style={{
        position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', flexDirection: 'column', gap: 8, zIndex: 9999, alignItems: 'center',
      }}>
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              background: 'rgba(40, 48, 60, 0.95)', color: '#fff',
              borderRadius: 'var(--radius-md)', padding: '10px 16px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.25)', fontSize: 'var(--font-size-sm)',
            }}
          >
            <span>{t.message}</span>
            {t.actionLabel && t.onAction && (
              <button
                style={{
                  background: 'transparent', border: '1px solid rgba(255,255,255,0.6)', color: '#fff',
                  borderRadius: 'var(--radius-sm)', padding: '2px 10px', cursor: 'pointer', fontSize: 'var(--font-size-sm)',
                }}
                onClick={() => { void t.onAction?.(); remove(t.id); }}
              >
                {t.actionLabel}
              </button>
            )}
            <button
              style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}
              onClick={() => remove(t.id)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}