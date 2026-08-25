import { describe, expect, it, vi } from 'vitest';

import { routeCommand } from './command-router.js';

describe('smart CLI entry', () => {
  it('opens setup on a first run with no command', async () => {
    const handlers = { setup: vi.fn(), start: vi.fn(), quick: vi.fn() };
    await routeCommand([], { loadState: () => null, handlers });
    expect(handlers.setup).toHaveBeenCalledOnce();
  });

  it('starts the configured mode on later runs with no command', async () => {
    const handlers = { setup: vi.fn(), start: vi.fn(), quick: vi.fn() };
    await routeCommand([], {
      loadState: () => ({ activeMode: 'named' }),
      handlers,
    });
    expect(handlers.start).toHaveBeenCalledOnce();
  });

  it('rejects remote deployment commands instead of silently accepting them', async () => {
    await expect(routeCommand(['deploy'], {
      loadState: () => null,
      handlers: { setup: vi.fn(), start: vi.fn(), quick: vi.fn() },
    })).rejects.toThrow(/Unknown command/);
  });

  it('routes every documented maintenance command without a remote deploy branch', async () => {
    const doctor = vi.fn();
    const handlers = {
      setup: vi.fn(), start: vi.fn(), quick: vi.fn(), doctor,
      stop: vi.fn(), status: vi.fn(), upgrade: vi.fn(), backup: vi.fn(),
      restore: vi.fn(), uninstall: vi.fn(), help: vi.fn(), serviceRun: vi.fn(),
    };
    await routeCommand(['doctor', '--json'], { loadState: () => ({ activeMode: 'quick' }), handlers });
    expect(doctor).toHaveBeenCalledWith(['--json']);
  });
});
