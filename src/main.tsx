// src/main.tsx

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initTheme } from './lib/theme-store';
import { startTriggerSync } from './lib/triggers';

initTheme();
startTriggerSync();

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
