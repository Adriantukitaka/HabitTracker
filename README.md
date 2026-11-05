# Constancia — app de hábitos para Android

App nativa para Android: hábitos, tareas, subactividades con variables de nombre libre, historial con gráficos y un tablero tipo GitHub.

- **Sin servidor y sin internet.** Todo se guarda en el teléfono.
- **Avisos como alarmas.** El recordatorio, el "deberías estar haciéndolo" (+15 min) y el resumen de las 23:30 se agendan en el propio Android. Llegan aunque la app esté cerrada y sobreviven a reiniciar el teléfono.
- **Respaldo.** En *Avisos → Tus datos* exportas un archivo `.json` (a Drive, correo o WhatsApp) y lo importas en otro dispositivo, por ejemplo en la versión de PC.

## Cómo conseguir el APK

### Opción A — Sin instalar nada: GitHub lo compila por ti

1. Crea un repositorio **privado** en github.com (por ejemplo `constancia`).
2. Sube esta carpeta con git (la carpeta oculta `.github` debe ir incluida):
   ```bash
   cd constancia-android
   git init -b main
   git add .
   git commit -m "Constancia"
   git remote add origin https://github.com/TU_USUARIO/constancia.git
   git push -u origin main
   ```
3. En el repositorio, entra a **Actions** y espera a que termine "APK de Android" (unos 5 minutos).
4. Desde el celular, abre el repositorio → **Releases** → descarga **Constancia.apk**.
5. Ábrelo. Android te pedirá permitir "instalar apps de fuentes desconocidas" para tu navegador o gestor de archivos. Acepta e instala.

Cada vez que hagas `git push`, se genera una versión nueva que se instala **encima de la anterior sin perder tus datos**: el APK siempre se firma con la misma clave (`android/app/constancia.keystore`). Por eso conviene que el repositorio sea privado.

### Opción B — Con Android Studio en tu PC

```bash
npm install
npm run android          # compila la app y la copia al proyecto Android
```

Abre la carpeta `android/` en Android Studio. Conecta el celular por USB con la *depuración USB* activada y pulsa ▶ Run. También puedes ejecutar `cd android && ./gradlew assembleRelease`; el APK queda en `android/app/build/outputs/apk/release/`.

## Primer uso en el teléfono

1. Crea tu primera actividad con **+ Nueva**. La app te pedirá permiso para mostrar avisos: acéptalo.
2. Si en **Avisos** aparece "Permitir alarmas exactas", tócalo y actívalo. Sin eso, Android puede retrasar los avisos unos minutos.
3. Algunos teléfonos (Xiaomi, Huawei, Samsung con ahorro agresivo) cierran las apps en segundo plano. Si un aviso no llega, entra a *Ajustes → Batería → Constancia* y elige "Sin restricciones".

Los avisos se agendan para los próximos 7 días cada vez que abres la app. Si pasas más de una semana sin abrirla, recibirás un aviso para que la abras y se reagenden.

## Probarla en el navegador

```bash
npm install
npm run dev              # http://localhost:5173 (en modo celular del navegador)
```

En el navegador los datos van a `localStorage` y no hay avisos del sistema.

## Estructura

| Carpeta | Qué hay |
| --- | --- |
| `src/engine/` | Motor de conflictos (grafo de intervalos: barrido O(n log n), huecos libres, resolución voraz) y estadísticas (agregación, promedios, mejor marca, rachas, heatmap) |
| `src/local/db.ts` | Base local: un documento JSON en el almacenamiento interno, guardado en dos ranuras alternas para que un corte no lo corrompa |
| `src/local/service.ts` | Reglas de negocio: ocurrencias a 7 días, estados, ventana de 24 h, choques, historial, tablero, bandeja y avisos planificados |
| `src/native.ts` | Android: avisos locales, permisos, botón atrás y respaldo |
| `src/screens/` | Hoy, Registro, Progreso, Tablero, Nueva actividad, Avisos |
| `android/` | Proyecto nativo (Capacitor 8) |
| `.github/workflows/android.yml` | Compila y publica el APK |

## Reglas

- Día activo de 08:00 a 24:00. Al abrir la app al día siguiente, lo pendiente pasa a "no hecho".
- Un registro se corrige hasta 24 h después de guardarlo; no se registran días futuros.
- El día de descanso no rompe la racha.
- Los choques se detectan al crear la actividad y en Hoy. Se propone mover la actividad de menor rango (tarea fija > hábito fijo > flexible, y luego la prioridad) al hueco libre más cercano. La decisión siempre es tuya.

## Pruebas

```bash
npm test     # 32 pruebas: motor, reglas, persistencia, avisos planificados, respaldo y flujos de pantallas
```
