#!/usr/bin/env node
/**
 * Install step for the browser client half: copies the hand-maintained
 * module-loader bundle (client-bundle/client.js) verbatim to lib/client.js,
 * which package.json exposes as exports["./client"] for the dsh
 * client-modules scanner (`dsh.client`). No transformation on purpose — the
 * file already speaks window.__ModuleLoader__.load and only requires the
 * platform-seeded 'react' row.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
mkdirSync(join(packageRoot, 'lib'), { recursive: true });
copyFileSync(join(packageRoot, 'client-bundle', 'client.js'), join(packageRoot, 'lib', 'client.js'));
console.log('[dsh-easyremote] client bundle -> lib/client.js');
