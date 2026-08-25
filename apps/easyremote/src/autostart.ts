import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type ServiceCommand = { executable: string; args: string[] };
export type UserServiceDefinition = { path: string; contents: string; serviceName: string };

export function renderUserService(
  platform: NodeJS.Platform,
  home: string,
  command: ServiceCommand,
): UserServiceDefinition {
  if (platform === 'darwin') {
    const argumentsXml = [command.executable, ...command.args]
      .map((value) => `      <string>${escapeXml(value)}</string>`)
      .join('\n');
    return {
      path: join(home, 'Library', 'LaunchAgents', 'io.github.hakimedes.dsheasyremote.plist'),
      serviceName: 'io.github.hakimedes.dsheasyremote',
      contents: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>io.github.hakimedes.dsheasyremote</string>
  <key>ProgramArguments</key><array>
${argumentsXml}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Background</string>
</dict></plist>
`,
    };
  }
  if (platform === 'linux') {
    const executable = [command.executable, ...command.args].map(quoteSystemd).join(' ');
    return {
      path: join(home, '.config', 'systemd', 'user', 'dsh-easyremote.service'),
      serviceName: 'dsh-easyremote.service',
      contents: `[Unit]
Description=DSH EasyRemote local Hub and Cloudflare Tunnel
After=network-online.target

[Service]
Type=simple
ExecStart=${executable}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`,
    };
  }
  if (platform === 'win32') {
    const executable = [command.executable, ...command.args].map(quoteWindows).join(' ');
    return {
      path: join(home, 'AppData', 'Local', 'DSH EasyRemote', 'autostart-command.txt'),
      serviceName: 'DSH EasyRemote',
      contents: `${executable}\r\n`,
    };
  }
  throw new Error(`User-login autostart is unsupported on ${platform}`);
}

export async function installUserAutostart(options: {
  platform?: NodeJS.Platform;
  home: string;
  command: ServiceCommand;
  run: (command: string, args: string[]) => Promise<void>;
}) {
  const platform = options.platform ?? process.platform;
  const definition = renderUserService(platform, options.home, options.command);
  mkdirSync(dirname(definition.path), { recursive: true, mode: 0o700 });
  writeFileSync(definition.path, definition.contents, { mode: 0o600 });
  if (platform !== 'win32') chmodSync(definition.path, 0o600);
  if (platform === 'darwin') {
    await options.run('launchctl', ['load', '-w', definition.path]);
  } else if (platform === 'linux') {
    await options.run('systemctl', ['--user', 'daemon-reload']);
    await options.run('systemctl', ['--user', 'enable', '--now', definition.serviceName]);
  } else {
    await options.run('schtasks', [
      '/Create', '/F', '/SC', 'ONLOGON', '/TN', definition.serviceName,
      '/TR', definition.contents.trim(),
    ]);
  }
  return definition;
}

export async function removeUserAutostart(options: {
  platform?: NodeJS.Platform;
  home: string;
  command: ServiceCommand;
  run: (command: string, args: string[]) => Promise<void>;
}) {
  const platform = options.platform ?? process.platform;
  const definition = renderUserService(platform, options.home, options.command);
  if (platform === 'darwin') {
    if (existsSync(definition.path)) await options.run('launchctl', ['unload', '-w', definition.path]);
  } else if (platform === 'linux') {
    await options.run('systemctl', ['--user', 'disable', '--now', definition.serviceName]);
    await options.run('systemctl', ['--user', 'daemon-reload']);
  } else {
    await options.run('schtasks', ['/Delete', '/F', '/TN', definition.serviceName]);
  }
  if (existsSync(definition.path)) unlinkSync(definition.path);
  return definition;
}

function escapeXml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function quoteSystemd(value: string) {
  return /^[a-zA-Z0-9_./:@+-]+$/.test(value) ? value : `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function quoteWindows(value: string) {
  return /^[a-zA-Z0-9_./:\\@+-]+$/.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`;
}
