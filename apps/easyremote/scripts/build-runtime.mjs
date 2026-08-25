import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(appDir, '..', '..');
const runtimeDir = join(appDir, 'runtime');
const hubDist = join(workspaceRoot, 'apps', 'hub', 'dist');
const connectorDir = join(workspaceRoot, 'apps', 'dsh-plugin');

if (!existsSync(join(hubDist, 'index.js'))) throw new Error('Hub must be built before packaging EasyRemote');
if (!existsSync(join(connectorDir, 'lib', 'index.js'))) throw new Error('Connector must be built before packaging EasyRemote');

rmSync(runtimeDir, { recursive: true, force: true });
mkdirSync(runtimeDir, { recursive: true });
cpSync(hubDist, join(runtimeDir, 'hub'), { recursive: true });

const packagedConnector = join(runtimeDir, 'connector');
mkdirSync(packagedConnector, { recursive: true });
for (const name of ['lib', 'README.md', 'cordis.patch.yml', 'dsh.plugin.json', 'package.json']) {
  cpSync(join(connectorDir, name), join(packagedConnector, name), { recursive: true });
}

console.log(`[dsh-easyremote] runtime bundle -> ${runtimeDir}`);
