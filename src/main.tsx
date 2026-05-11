import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { Web3Provider } from './Web3Provider.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { monitor } from './lib/monitor';
import { installProviderProtection } from './lib/walletProviderManager';

// Install wallet provider protection as early as possible.
// This suppresses SES lockdown errors and MetaMask provider conflict warnings
// that occur when multiple wallet extensions are installed.
// The cleanup function is intentionally not called — these handlers should
// remain active for the entire app lifecycle.
installProviderProtection();

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
