// src/main.tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './contexts/AuthContext';

window.addEventListener('unhandledrejection', (event) => {
  const err = event.reason;
  const name = String(err?.name || '');
  const message = String(err?.message || '').toLowerCase();

  if (name === 'AbortError' || message.includes('aborted')) {
    event.preventDefault();
  }
});

const root = createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);