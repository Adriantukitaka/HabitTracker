import { useCallback, useEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api, getLocal } from './api';
import { TabBar, ToastProvider } from './components/ui';
import { setupNative } from './native';
import Activity from './screens/Activity';
import Dashboard from './screens/Dashboard';
import NewActivity from './screens/NewActivity';
import Notices from './screens/Notices';
import Progress from './screens/Progress';
import Today from './screens/Today';

const TAB_PATHS = ['/', '/tablero', '/avisos'];

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [unread, setUnread] = useState(0);
  const path = useRef(location.pathname);
  path.current = location.pathname;

  const refreshUnread = useCallback(() => {
    api
      .notifications()
      .then((list) => setUnread(list.filter((n) => !n.read).length))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshUnread();
    const id = window.setInterval(refreshUnread, 60_000);
    window.addEventListener('constancia:resume', refreshUnread);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('constancia:resume', refreshUnread);
    };
  }, [refreshUnread]);

  // Android: avisos locales, botón atrás y abrir la actividad al tocar un aviso.
  useEffect(() => {
    void setupNative(
      getLocal(),
      (url) => navigate(url),
      () => {
        if (path.current === '/') return false;
        if (TAB_PATHS.includes(path.current)) navigate('/');
        else navigate(-1);
        return true;
      },
    );
  }, [navigate]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Today />} />
        <Route path="/actividad/:id" element={<Activity />} />
        <Route path="/progreso/:variableId" element={<Progress />} />
        <Route path="/tablero" element={<Dashboard />} />
        <Route path="/nueva" element={<NewActivity />} />
        <Route path="/avisos" element={<Notices onRead={() => setUnread(0)} />} />
        <Route path="*" element={<Today />} />
      </Routes>
      {TAB_PATHS.includes(location.pathname) && <TabBar unread={unread} />}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
