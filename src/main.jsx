import { createRoot } from 'react-dom/client'
import { inject } from '@vercel/analytics';
import { initTheme } from './ui/theme'
import { initEngine } from './state/transfer'
import App from './App'
import './styles.css'

inject(); // Vercel Analytics
initTheme();
initEngine();

createRoot(document.getElementById('app')).render(<App />);
