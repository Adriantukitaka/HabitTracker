import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { initLocal } from './api';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

initLocal()
  .then(() =>
    root.render(
      <StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StrictMode>,
    ),
  )
  .catch((e) => {
    root.render(
      <main className="screen">
        <div className="card empty" role="alert">
          No se pudieron abrir tus datos. Cierra la app y vuelve a abrirla.
          <br />
          <small>{String(e)}</small>
        </div>
      </main>,
    );
  });
