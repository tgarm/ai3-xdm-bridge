import { createRoot } from 'react-dom/client'
import { inject } from '@vercel/analytics';
import { initTheme } from './ui/theme'
import { initEngine } from './state/transfer'
import App from './App'
import './styles.css'

// Vercel Analytics only where the app is actually deployed — locally the
// injected script 404s and litters the console.
if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) {
  inject();
}
initTheme();
initEngine();

createRoot(document.getElementById('app')).render(<App />);
