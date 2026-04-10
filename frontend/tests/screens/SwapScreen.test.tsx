import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SwapScreen from '../../src/screens/SwapScreen';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { mainnet } from 'wagmi/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const config = createConfig({ chains: [mainnet], transports: { [mainnet.id]: http() } });
const queryClient = new QueryClient();

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <WagmiProvider config={config}>
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  </WagmiProvider>
);

describe('SwapScreen', () => {
  it('toggles token select modal when asset is clicked', () => {
    render(<Wrapper><SwapScreen /></Wrapper>);
    
    // We expect the native DOM text 'DOGE' because it's the initial sell asset
    const selectTokenBtn = screen.getByText('DOGE'); 
    fireEvent.click(selectTokenBtn);
    
    // Once clicked, the modal title 'Select a Token' should appear
    expect(screen.getByText('Select a Token')).toBeDefined();
  });
});
