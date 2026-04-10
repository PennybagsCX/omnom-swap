import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PoolsScreen from '../../src/screens/PoolsScreen';
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

describe('PoolsScreen', () => {
  it('renders the liquidity grid section', () => {
    render(<Wrapper><PoolsScreen /></Wrapper>);
    expect(screen.getByText(/THE FEEDING GROUNDS/i)).toBeDefined();
  });
});
