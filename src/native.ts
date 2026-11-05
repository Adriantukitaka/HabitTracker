import { Capacitor } from '@capacitor/core';
import type { Local } from './local/service';

/**
 * Integración con Android: avisos locales (como alarmas del calendario), botón atrás y respaldo.
 * En el navegador todo esto queda desactivado sin errores.
 */

const CHANNEL = 'recordatorios';
const native = () => Capacitor.isNativePlatform();

export type NoticePermission = 'granted' | 'denied' | 'prompt' | 'unavailable';

export async function notificationPermission(): Promise<NoticePermission> {
  if (!native()) return 'unavailable';
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const p = await LocalNotifications.checkPermissions();
  return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt';
}

/** Pide el permiso de avisos (Android 13+). */
export async function requestNotificationPermission(): Promise<NoticePermission> {
  if (!native()) return 'unavailable';
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const p = await LocalNotifications.requestPermissions();
  return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt';
}

/** Android 12+: las alarmas exactas hacen que el aviso llegue al minuto y no unos minutos tarde. */
export async function exactAlarms(): Promise<'granted' | 'denied' | 'unavailable'> {
  if (!native()) return 'unavailable';
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const r = await LocalNotifications.checkExactNotificationSetting();
    return r.exact_alarm === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unavailable';
  }
}

export async function openExactAlarmSettings(): Promise<void> {
  if (!native()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await LocalNotifications.changeExactNotificationSetting();
}

let timer: number | undefined;
let running: Promise<void> = Promise.resolve();

/** Reagenda todos los avisos de los próximos 7 días (se agrupan los cambios seguidos). */
export function rescheduleSoon(local: Local, delay = 400) {
  if (!native()) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    running = running.then(() => reschedule(local)).catch(() => {});
  }, delay);
}

async function reschedule(local: Local): Promise<void> {
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) {
    await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  }
  const planned = local.planned().slice(0, 400); // Android admite ~500 alarmas por app
  if (!planned.length) return;
  await LocalNotifications.schedule({
    notifications: planned.map((p) => ({
      id: p.id,
      title: p.title,
      body: p.body,
      channelId: CHANNEL,
      smallIcon: 'ic_stat_constancia',
      iconColor: '#1F883D',
      autoCancel: true,
      extra: { url: p.url },
      schedule: { at: p.at, allowWhileIdle: true },
    })),
  });
}

/** Canal de avisos, botón atrás y apertura de la actividad al tocar un aviso. */
export async function setupNative(local: Local, navigate: (url: string) => void, goBack: () => boolean) {
  if (!native()) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const { App } = await import('@capacitor/app');

  await LocalNotifications.createChannel({
    id: CHANNEL,
    name: 'Recordatorios',
    description: 'Recordatorios de tus hábitos y tareas',
    importance: 4,
    visibility: 1,
    vibration: true,
  }).catch(() => {});

  await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const url = (action.notification.extra as { url?: string } | undefined)?.url;
    if (url) navigate(url);
  });

  await App.addListener('backButton', () => {
    if (!goBack()) void App.exitApp();
  });

  // Al volver a la app: cerrar días, anotar avisos mostrados y reagendar.
  await App.addListener('resume', async () => {
    await local.tick();
    rescheduleSoon(local, 0);
    window.dispatchEvent(new Event('constancia:resume'));
  });

  local.onChange = () => rescheduleSoon(local);
  rescheduleSoon(local, 0);
}

// ---------------------------------------------------------------- respaldo

/** Guarda el respaldo como archivo y abre el menú de compartir (Drive, correo, WhatsApp…). */
export async function shareBackup(json: string, fileName: string): Promise<'shared' | 'downloaded'> {
  if (native()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const written = await Filesystem.writeFile({ path: fileName, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: 'Respaldo de Constancia', files: [written.uri], dialogTitle: 'Guardar respaldo' });
    return 'shared';
  }
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'downloaded';
}
