import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import PoolsScreen from '../../src/screens/PoolsScreen';

describe('PoolsScreen', () => {
  it('renders the liquidity grid section', () => {
    render(<PoolsScreen />);
    expect(screen.getByText(/THE FEEDING GROUNDS/i)).toBeDefined();
  });
});
