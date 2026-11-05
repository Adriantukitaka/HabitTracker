import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App';
import { getLocal, initLocal } from '../src/api';
import { seed } from './seed';

beforeEach(async () => {
  const storage = await seed();
  await initLocal(storage);
});

afterEach(() => {
  vi.useRealTimers();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

const user = () => userEvent.setup();

describe('Hoy', () => {
  it('muestra la actividad en curso, el avance y el choque', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { name: 'Hoy' })).toBeTruthy();
    const now = await screen.findByRole('region', { name: 'Actividad en curso' });
    expect(within(now).getByText('Ejercicio')).toBeTruthy();
    expect(within(now).getByRole('link', { name: 'Registrar ahora' })).toBeTruthy();
    expect(screen.getByText(/de 6 hechas/)).toBeTruthy();
    expect(screen.getByText('Choca con Llamar al banco')).toBeTruthy();
  });

  it('suma +1 a un contador y permite deshacer', async () => {
    const u = user();
    renderAt('/');
    await screen.findByText('3 de 8 páginas');
    await u.click(screen.getByRole('button', { name: 'Sumar a Leer' }));
    await screen.findByText('4 de 8 páginas');
    const toast = await screen.findByRole('status');
    await u.click(within(toast).getByRole('button', { name: 'Deshacer' }));
    await screen.findByText('3 de 8 páginas');
  });

  it('resuelve el choque moviendo la actividad flexible', async () => {
    const u = user();
    renderAt('/');
    await screen.findByText('Choca con Llamar al banco');
    expect(screen.queryByRole('button', { name: 'Resolver choque de Llamar al banco' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Resolver choque de Inglés' }));
    const dialog = await screen.findByRole('dialog', { name: 'Resolver choque' });
    expect(within(dialog).getByText(/es fija y de prioridad alta/)).toBeTruthy();
    await u.click(await within(dialog).findByRole('button', { name: 'Mover Inglés a 18:30' }));
    await waitFor(() => expect(screen.queryByText('Choca con Llamar al banco')).toBeNull());
  });

  it('marcar una tarea sin variables la pasa a Hechas', async () => {
    const u = user();
    renderAt('/');
    await u.click(await screen.findByRole('button', { name: 'Marcar Llamar al banco como hecho' }));
    await screen.findByText('Llamar al banco marcado como hecho');
    expect(screen.getByRole('heading', { name: 'Hechas' })).toBeTruthy();
  });
});

describe('Registro de actividad', () => {
  it('registra variables de subactividades, muestra el valor de ayer y guarda', async () => {
    const today = await getLocal().todayView();
    const ejercicio = today.items.find((c) => c.title === 'Ejercicio')!;
    const u = user();
    renderAt(`/actividad/${ejercicio.id}`);
    await screen.findByRole('heading', { name: 'Ejercicio' });
    expect(screen.getByText('Calentamiento')).toBeTruthy();
    await u.click((await screen.findAllByRole('button', { name: 'Completar con la meta' }))[0]);
    await u.click(screen.getByRole('button', { name: /Sentadilla/ }));
    expect(screen.getByText(/ayer 37,5 kg/)).toBeTruthy();
    const peso = screen.getByRole('spinbutton', { name: 'peso' });
    await u.clear(peso);
    await u.type(peso, '40');
    await u.click(screen.getByRole('button', { name: 'Guardar registro' }));
    await screen.findByText(/Guardado a las/);
    const d = await getLocal().occurrence(ejercicio.id);
    expect(d.items.find((i) => i.name === 'Sentadilla')!.variables.find((v) => v.name === 'peso')!.value).toBe(40);
    expect(d.card.status).toBe('PARTIAL');
  });

  it('no permite registrar un día futuro', async () => {
    const tomorrow = getLocal()
      .planned()
      .find((p) => p.title === 'Es hora de Leer' && p.at.getDate() === 21)!;
    const id = Number(tomorrow.url.split('/').pop());
    renderAt(`/actividad/${id}`);
    await screen.findByText('Todavía no se puede registrar: es un día futuro.');
    expect(screen.queryByRole('button', { name: 'Guardar registro' })).toBeNull();
  });
});

describe('Progreso de subactividad', () => {
  it('compara hoy con ayer y el promedio, en gráfico y tabla', async () => {
    const today = await getLocal().todayView();
    const ejercicio = today.items.find((c) => c.title === 'Ejercicio')!;
    const d = await getLocal().occurrence(ejercicio.id);
    const peso = d.items.find((i) => i.name === 'Sentadilla')!.variables.find((v) => v.name === 'peso')!;
    await getLocal().saveCheckin(ejercicio.id, [{ variableId: peso.id, value: 40 }]);
    const u = user();
    renderAt(`/progreso/${peso.id}`);
    await screen.findByRole('heading', { name: 'Sentadilla' });
    expect(screen.getByRole('tab', { name: 'Peso' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByText('Ayer').length).toBe(2); // tarjeta y fila de la tabla
    expect(screen.getByText('+2,5 kg hoy')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Peso de Sentadilla en los últimos 7 días; hoy 40/ })).toBeTruthy();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(5);
    await u.click(screen.getByRole('button', { name: 'Barras' }));
    await u.click(screen.getByRole('button', { name: '30 días' }));
    await screen.findByText('Promedio 30 d');
    await u.click(screen.getByRole('tab', { name: 'Repeticiones' }));
    await screen.findByRole('img', { name: /Repeticiones de Sentadilla/ });
  });
});

describe('Tablero y avisos', () => {
  it('muestra rachas, heatmap y retos', async () => {
    renderAt('/tablero');
    await screen.findByRole('heading', { name: 'Tablero' });
    expect(screen.getByRole('img', { name: /Mapa de cumplimiento/ })).toBeTruthy();
    expect(screen.getByText('día 30/45')).toBeTruthy(); // Ejercicio
    expect(screen.getAllByText(/Racha/).length).toBeGreaterThan(2);
  });

  it('lista los avisos, el cierre de ayer y el respaldo', async () => {
    renderAt('/avisos');
    await screen.findByRole('heading', { name: 'Avisos' });
    expect(await screen.findByText('Llamar al banco choca con otra actividad')).toBeTruthy();
    expect(screen.getByText('Ayer · cierre del día')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Exportar respaldo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Importar' })).toBeTruthy();
  });
});

describe('Nueva actividad', () => {
  it('valida, detecta el choque, usa el hueco libre y crea un hábito con subactividades', async () => {
    const u = user();
    renderAt('/nueva');
    await u.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByText('Escribe un nombre para continuar.')).toBeTruthy();
    await u.type(screen.getByLabelText('Nombre'), 'Guitarra');
    await u.click(screen.getByRole('button', { name: 'Siguiente' }));
    await u.click(screen.getByRole('button', { name: 'Todos los días' }));
    const hora = screen.getByLabelText('Hora');
    await u.clear(hora);
    await u.type(hora, '13:00');
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert.textContent).toContain('Se cruza con «Leer»');
    await u.click(within(alert).getByRole('button', { name: 'Usar el hueco libre: 13:30' }));
    await screen.findByText(/Sin choques en ese horario/, {}, { timeout: 3000 });
    await u.click(screen.getByRole('button', { name: 'Siguiente' }));
    await u.click(screen.getByRole('tab', { name: 'Subactividades' }));
    await u.type(screen.getByLabelText('Subactividad 1'), 'Escalas');
    await u.type(screen.getByLabelText('Nombre de la variable'), 'minutos');
    await u.type(screen.getByLabelText('Meta diaria'), '15');
    await u.click(screen.getByRole('button', { name: 'Crear actividad' }));
    await screen.findByRole('heading', { name: 'Hoy' });
    const created = (await getLocal().activities()).find((a) => a.title === 'Guitarra')!;
    expect(created.start).toBe('13:30');
    expect(created.variableCount).toBe(1);
    expect(await screen.findByText('Guitarra')).toBeTruthy();
  });
});
