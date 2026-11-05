import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Bell, Calendar, Grid } from './Icons';

// ---------------------------------------------------------------- toast con "Deshacer"

interface ToastState {
  message: string;
  undo?: () => void;
  high?: boolean;
}

const ToastContext = createContext<(t: ToastState) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((t: ToastState) => {
    window.clearTimeout(timer.current);
    setToast(t);
    timer.current = window.setTimeout(() => setToast(null), t.undo ? 6000 : 3500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div role="status" className={`toast${toast.high ? ' high' : ''}`}>
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              Deshacer
            </button>
          )}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------------------------------------------------------------- hoja inferior

export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={label} className="sheet" onClick={(e) => e.stopPropagation()}>
        <span className="grip" />
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- barra de pestañas

export function TabBar({ unread }: { unread: number }) {
  return (
    <nav className="tabbar" aria-label="Principal">
      <div className="tabbar-inner">
        <NavLink to="/" end className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
          <Calendar />
          Hoy
        </NavLink>
        <NavLink to="/tablero" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
          <Grid />
          Tablero
        </NavLink>
        <NavLink to="/avisos" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
          <Bell />
          Avisos
          {unread > 0 && (
            <span className="badge" aria-label={`${unread} avisos sin leer`}>
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </NavLink>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------- carga de datos

export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, setData, error, loading, reload };
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card empty" role="alert">
      <p style={{ margin: '0 0 12px' }}>{message}</p>
      <button type="button" className="btn" onClick={onRetry}>
        Reintentar
      </button>
    </div>
  );
}

export function Skeleton({ height }: { height: number }) {
  return <div className="skeleton" style={{ height }} aria-hidden="true" />;
}

export function ProgressBar({ pct, color, thin, label }: { pct: number; color?: string; thin?: boolean; label?: string }) {
  return (
    <div
      className={`bar${thin ? ' thin' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
    >
      <span style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

export function StatusPill({ status, progress }: { status: string; progress?: number }) {
  const map: Record<string, [string, string]> = {
    DONE: ['done', 'Hecho'],
    PARTIAL: ['partial', progress !== undefined ? `Parcial · ${progress} %` : 'Parcial'],
    PENDING: ['pending', 'Pendiente'],
    MISSED: ['missed', 'No hecho'],
    SKIPPED: ['pending', 'Descanso'],
  };
  const [cls, text] = map[status] ?? ['pending', status];
  return <span className={`pill ${cls}`}>{text}</span>;
}
