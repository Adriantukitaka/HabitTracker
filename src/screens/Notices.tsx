import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { addDays, clock, dayMonth } from '../format';
import type { NotificationView } from '../types';
import { Bell, Check, Clock, Warn } from '../components/Icons';
import { LoadError, Skeleton, useLoad, useToast } from '../components/ui';
import {
  exactAlarms,
  notificationPermission,
  openExactAlarmSettings,
  requestNotificationPermission,
  shareBackup,
  type NoticePermission,
} from '../native';

const ICON: Record<NotificationView['type'], { bg: string; fg: string; tagColor: string; tag: string; icon: (c: string) => ReactNode }> = {
  REMINDER: { bg: 'var(--green-bg)', fg: 'var(--green)', tagColor: 'var(--green-ink)', tag: 'Recordatorio', icon: (c) => <Bell size={18} color={c} /> },
  NUDGE: { bg: 'var(--orange-bg)', fg: 'var(--orange)', tagColor: 'var(--orange-ink)', tag: 'Deberías estar haciéndolo', icon: (c) => <Clock color={c} /> },
  CONFLICT: { bg: 'var(--orange-bg)', fg: 'var(--orange)', tagColor: 'var(--orange-ink)', tag: 'Conflicto detectado', icon: (c) => <Warn color={c} /> },
  SUMMARY: { bg: '#EFEFEC', fg: 'var(--ink-2)', tagColor: 'var(--ink-2)', tag: 'Resumen del día', icon: (c) => <Bell size={18} color={c} /> },
  DONE: { bg: 'var(--green-bg)', fg: 'var(--green)', tagColor: 'var(--green-ink)', tag: 'Hecho', icon: (c) => <Check color={c} /> },
};

export default function Notices({ onRead }: { onRead: () => void }) {
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const { data, error, reload } = useLoad(async () => {
    const [list, settings, today] = await Promise.all([api.notifications(), api.settings(), api.today()]);
    const yesterday = await api.day(addDays(today.date, -1));
    return { list, settings, today: today.date, yesterday };
  }, []);
  const [perm, setPerm] = useState<NoticePermission>('unavailable');
  const [exact, setExact] = useState<'granted' | 'denied' | 'unavailable'>('unavailable');
  const [confirmImport, setConfirmImport] = useState<string | null>(null);

  const refreshPermissions = () => {
    notificationPermission().then(setPerm).catch(() => {});
    exactAlarms().then(setExact).catch(() => {});
  };

  useEffect(() => {
    refreshPermissions();
    window.addEventListener('constancia:resume', refreshPermissions);
    return () => window.removeEventListener('constancia:resume', refreshPermissions);
  }, []);

  useEffect(() => {
    if (data?.list.some((n) => !n.read)) api.markRead().then(onRead).catch(() => {});
  }, [data, onRead]);

  if (error && !data) return <main className="screen"><LoadError message={error} onRetry={reload} /></main>;
  if (!data) {
    return (
      <main className="screen">
        <Skeleton height={60} />
        <Skeleton height={90} />
        <Skeleton height={90} />
      </main>
    );
  }

  const todayList = data.list.filter((n) => localDay(n.createdAt) === data.today);
  const older = data.list.filter((n) => localDay(n.createdAt) !== data.today);
  const y = data.yesterday;
  const fix = y.items.find((i) => i.status === 'MISSED' || i.status === 'PARTIAL');

  async function exportBackup() {
    try {
      const json = await api.exportJson();
      const how = await shareBackup(json, `constancia-${data!.today}.json`);
      toast({ message: how === 'shared' ? 'Respaldo listo para guardar' : 'Respaldo descargado' });
    } catch (e) {
      if (e instanceof Error && /cancel/i.test(e.message)) return;
      toast({ message: e instanceof Error ? e.message : 'No se pudo exportar' });
    }
  }

  async function doImport(text: string) {
    try {
      const r = await api.importJson(text);
      toast({ message: `Respaldo importado: ${r.activities} actividades, ${r.checkins} registros` });
      setConfirmImport(null);
      void reload();
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'No se pudo importar' });
    }
  }

  return (
    <main className="screen">
      <div className="stack">
        <span className="eyebrow">Notificaciones</span>
        <h1 className="title">Avisos</h1>
      </div>

      {perm === 'prompt' && (
        <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 14, lineHeight: 1.5 }}>Activa los avisos para recibir tus recordatorios a la hora, como una alarma del calendario.</span>
          <button type="button" className="btn btn-primary" onClick={() => requestNotificationPermission().then(setPerm)}>
            Activar avisos
          </button>
        </div>
      )}
      {perm === 'denied' && (
        <div className="banner">Los avisos están bloqueados. Actívalos en Ajustes del teléfono → Apps → Constancia → Notificaciones.</div>
      )}
      {perm === 'granted' && exact === 'denied' && (
        <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 14, lineHeight: 1.5 }}>Para que los avisos lleguen al minuto exacto, permite las alarmas exactas.</span>
          <button type="button" className="btn" onClick={() => openExactAlarmSettings().then(refreshPermissions)}>
            Permitir alarmas exactas
          </button>
        </div>
      )}

      <h2 className="section">Hoy</h2>
      {todayList.length === 0 && <div className="card empty">Sin avisos por ahora.</div>}
      {todayList.map((n) => <NoticeRow key={n.id} n={n} />)}

      {y.total > 0 && (
        <>
          <h2 className="section">Ayer · cierre del día</h2>
          <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{y.done} de {y.total} cumplidas</span>
            <div style={{ display: 'flex', gap: 4 }} aria-hidden="true">
              {y.done > 0 && <span style={{ flex: y.done, height: 8, borderRadius: 4, background: 'var(--green-2)' }} />}
              {y.partial > 0 && <span style={{ flex: y.partial, height: 8, borderRadius: 4, background: '#F2B35B' }} />}
              {y.missed > 0 && <span style={{ flex: y.missed, height: 8, borderRadius: 4, background: 'var(--line)' }} />}
            </div>
            <span className="small muted" style={{ lineHeight: 1.45 }}>
              {y.items
                .filter((i) => i.status === 'MISSED' || i.status === 'PARTIAL')
                .map((i) => `${i.title} quedó ${i.status === 'MISSED' ? 'como no hecho' : `parcial (${i.progress} %)`}`)
                .join('. ') || 'Cumpliste todo.'}
              {fix && ' Puedes corregirlo hasta hoy a las 24:00.'}
            </span>
            {fix && (
              <Link to={`/actividad/${fix.id}`} className="btn">
                Corregir registro de ayer
              </Link>
            )}
          </div>
        </>
      )}

      {older.length > 0 && <h2 className="section">Anteriores</h2>}
      {older.slice(0, 15).map((n) => <NoticeRow key={n.id} n={n} today={data.today} />)}

      <h2 className="section">Ajustes de avisos</h2>
      <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
        {[
          ['Recordatorio', 'a la hora exacta'],
          ['«Deberías estar haciéndolo»', `+${data.settings.nudgeMinutes} min`],
          ['Resumen del día', data.settings.summaryTime],
          ['Día activo', `${data.settings.dayStart} – ${data.settings.dayEnd}`],
          ['Avisos en este teléfono', perm === 'granted' ? 'activados' : perm === 'unavailable' ? 'solo en Android' : 'desactivados'],
        ].map(([label, value], i, arr) => (
          <div key={label} className="spread" style={{ minHeight: 52, padding: '0 14px', borderBottom: i < arr.length - 1 ? '1px solid var(--line-2)' : 0 }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{label}</span>
            <span className="mono muted" style={{ fontSize: 13 }}>{value}</span>
          </div>
        ))}
      </div>

      <h2 className="section">Tus datos</h2>
      <div className="card pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 14, lineHeight: 1.5 }}>
          Todo se guarda solo en este teléfono. Exporta un respaldo para pasarlo a la PC o guardarlo en Drive.
        </span>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn grow" onClick={exportBackup}>Exportar respaldo</button>
          <button type="button" className="btn grow" onClick={() => fileInput.current?.click()}>Importar</button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          aria-label="Archivo de respaldo"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) setConfirmImport(await file.text());
          }}
        />
        {confirmImport !== null && (
          <div role="alert" className="alert">
            <span>Importar <b>reemplaza todos los datos</b> de este teléfono por los del respaldo. Exporta primero si quieres conservarlos.</span>
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn grow" onClick={() => setConfirmImport(null)}>Cancelar</button>
              <button type="button" className="btn grow" style={{ background: 'var(--orange)', borderColor: 'var(--orange)', color: '#fff' }} onClick={() => doImport(confirmImport)}>
                Reemplazar
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function NoticeRow({ n, today }: { n: NotificationView; today?: string }) {
  const meta = ICON[n.type] ?? ICON.SUMMARY;
  const body = (
    <div className="card pad" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {meta.icon(meta.fg)}
      </div>
      <div className="stack grow" style={{ gap: 3 }}>
        <div className="spread">
          <span style={{ fontSize: 12, fontWeight: 700, color: meta.tagColor }}>{meta.tag}</span>
          <span className="mono small muted" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
            {today ? `${localDay(n.createdAt) === addDays(today, -1) ? 'Ayer' : dayMonth(localDay(n.createdAt))} ` : ''}
            {clock(n.createdAt)}
          </span>
        </div>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{n.title}</span>
        <span className="small muted" style={{ lineHeight: 1.45 }}>{n.body}</span>
      </div>
    </div>
  );
  return n.occurrenceId ? (
    <Link to={`/actividad/${n.occurrenceId}`} style={{ textDecoration: 'none' }}>
      {body}
    </Link>
  ) : (
    body
  );
}

function localDay(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
