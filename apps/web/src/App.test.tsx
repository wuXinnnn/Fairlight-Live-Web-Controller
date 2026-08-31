import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FakeSocket } from '../tests/fake-socket.js';
import { App } from './App.js';

describe('App', () => {
  it('renders the permanent dark control desk without a theme switch', () => {
    render(<App socket={new FakeSocket()} />);
    expect(screen.getByRole('heading', { name: 'CONTROL DESK' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('data-theme', 'dark');
    expect(screen.queryByRole('button', { name: /theme/i })).not.toBeInTheDocument();
    expect(screen.getByText('EMBER DISCONNECTED')).toBeInTheDocument();
  });
});
