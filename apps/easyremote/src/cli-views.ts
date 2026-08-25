import type { InstallState } from './install-state.js';

export function formatHelp(): string {
  return `DSH EasyRemote — local-first mobile access for DeepSeek Harness

Usage:
  dsh-easyremote                 Smart entry: setup first, then start and open console
  dsh-easyremote setup           Open the localhost setup wizard
  dsh-easyremote quick           Start local Hub + temporary Quick Tunnel
  dsh-easyremote start           Start the configured local mode
  dsh-easyremote stop            Stop locally managed processes or user service
  dsh-easyremote status          Show Hub, Tunnel and Connector state
  dsh-easyremote doctor [--json] Diagnose Node, cloudflared, DNS, Hub and Connector
  dsh-easyremote upgrade         Back up data, then show the safe npm upgrade command
  dsh-easyremote backup [path]   Create a consistent backup without secret keys
  dsh-easyremote restore <path>  Restore a backup while the local service is stopped
  dsh-easyremote uninstall       Remove launch integration and preserve local data

Hub always listens on 127.0.0.1. Deep configuration creates a Cloudflare
Named Tunnel on this computer and never logs in to another server.
`;
}

export function formatStatus(state: InstallState | null, running: boolean): string {
  if (!state) return 'DSH EasyRemote: Not configured. Run `dsh-easyremote setup`.';
  return [
    `Mode: ${state.activeMode}`,
    `Runtime: ${running ? 'online' : 'offline'}`,
    `Local Hub: ${state.hub.host}:${state.hub.port}`,
    `Public origin: ${state.tunnel.publicOrigin ?? 'pending'}`,
    `Hub ID: ${state.hub.hubId}`,
  ].join('\n');
}
