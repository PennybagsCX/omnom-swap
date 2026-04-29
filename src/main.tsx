import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { Web3Provider } from './Web3Provider.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { monitor } from './lib/monitor';

monitor.install();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <Web3Provider>
        <App />
      </Web3Provider>
    </ErrorBoundary>
  </StrictMode>,
);
