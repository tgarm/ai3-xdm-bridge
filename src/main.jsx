import { createRoot } from 'react-dom/client'
import { inject } from '@vercel/analytics';
import { initTheme } from './ui/theme'
import { initEngine } from './state/transfer'
import App from './App'
import './styles.css'

// Vercel Analytics only where the app is actually deployed — locally (and
// on any LAN/private address) the injected script 404s and litters the
// console.
const host = window.location.hostname;
const isPrivate = ['localhost', '127.0.0.1'].includes(host)
  || host.endsWith('.local')
  || /^192\.168\./.test(host)
  || /^10\./.test(host)
  || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
if (!isPrivate) {
  inject();
}
initTheme();
initEngine();

createRoot(document.getElementById('app')).render(<App />);
