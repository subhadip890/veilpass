import './shims/browserGlobals';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { initializeMidnightNetwork } from './providers/networkConfig';

// Initialize global Midnight network to Preprod before React renders
initializeMidnightNetwork();

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found in DOM. Check index.html.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
