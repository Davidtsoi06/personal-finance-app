/**
 * SlidePanel — a panel that slides in from the right side.
 * Not a modal: doesn't block interaction with the underlying page.
 * Used for trade history, holding details, etc.
 */
import { useEffect, useRef } from 'react';
import { Button } from './Button';
import './SlidePanel.css';

interface SlidePanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  width?: number;
  children: React.ReactNode;
}

export function SlidePanel({ open, onClose, title, width = 560, children }: SlidePanelProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  // Prevent body scroll when panel is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="slide-panel-overlay" ref={overlayRef} onClick={(e) => {
      if (e.target === overlayRef.current) onClose();
    }}>
      <div
        className="slide-panel"
        style={{ width: `${width}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="slide-panel-header">
          <h3 className="slide-panel-title">{title}</h3>
          <Button variant="secondary" size="sm" onClick={onClose}>✕ 关闭</Button>
        </div>
        <div className="slide-panel-body">
          {children}
        </div>
      </div>
    </div>
  );
}
