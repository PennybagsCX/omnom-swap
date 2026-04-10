import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SwapScreen from '../../src/screens/SwapScreen';

describe('SwapScreen', () => {
  it('toggles token select modal when asset is clicked', () => {
    render(<SwapScreen />);
    
    // We expect the native DOM text 'DOGE' because it's the initial sell asset
    const selectTokenBtn = screen.getByText('DOGE'); 
    fireEvent.click(selectTokenBtn);
    
    // Once clicked, the modal title 'Select a Token' should appear
    expect(screen.getByText('Select a Token')).toBeDefined();
  });
});
