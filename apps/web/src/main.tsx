import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import 'allotment/dist/style.css';
import './index.css';
import { App } from './App.tsx';
import { initialize } from './store.ts';

void initialize();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
