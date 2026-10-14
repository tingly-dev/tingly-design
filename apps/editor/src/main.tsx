import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AiSettingsHost } from './components/AiSettings';
import { useStore } from './store';
import { initLanguage } from './i18n';
import { initTheme } from './theme';
import { listenToHost } from './host';
import './styles.css';

initLanguage();
initTheme();
listenToHost();

// handy in devtools and for the end-to-end tests
if (import.meta.env.DEV) (window as unknown as { __dc: typeof useStore }).__dc = useStore;

createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <AiSettingsHost />
  </>,
);
