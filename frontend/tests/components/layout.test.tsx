import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Header from '../../src/components/layout/Header';

describe('Header', () => {
  it('renders the $OMNOM logo', () => {
    render(<Header />);
    expect(screen.getByText('$OMNOM')).toBeDefined();
  });
});
