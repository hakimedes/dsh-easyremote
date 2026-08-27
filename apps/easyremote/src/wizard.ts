import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import QRCode from 'qrcode';

import type { LocalPairingState } from './pairing-state.js';

const SESSION_COOKIE = 'dsh_easyremote_session';

export function wizardListenOptions() {
  return { host: '127.0.0.1' as const, port: 0 };
}

export function createWizardSecrets() {
  return {
    sessionToken: randomBytes(32).toString('base64url'),
    csrfToken: randomBytes(32).toString('base64url'),
  };
}

type WizardAuthorization = {
  method: string;
  host?: string;
  expectedHost: string;
  sessionToken: string;
  csrfToken: string;
  cookie?: string;
  csrf?: string;
  origin?: string;
};

export function authorizeWizardRequest(input: WizardAuthorization): { ok: true } | { ok: false; status: number; message: string } {
  if (input.host !== input.expectedHost) return { ok: false, status: 403, message: 'Invalid Host header' };
  const cookies = parseCookies(input.cookie);
  if (cookies.get(SESSION_COOKIE) !== input.sessionToken) {
    return { ok: false, status: 401, message: 'Wizard session required' };
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(input.method.toUpperCase())) {
    if (input.origin !== `http://${input.expectedHost}`) {
      return { ok: false, status: 403, message: 'Invalid request origin' };
    }
    if (input.csrf !== input.csrfToken) return { ok: false, status: 403, message: 'Invalid CSRF token' };
  }
  return { ok: true };
}

function parseCookies(header = '') {
  const cookies = new Map<string, string>();
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator <= 0) continue;
    cookies.set(item.slice(0, separator).trim(), item.slice(separator + 1).trim());
  }
  return cookies;
}

export class WizardActionGate {
  private readonly used = new Set<string>();

  async run<T>(requestId: string, task: () => Promise<T>): Promise<T> {
    if (!requestId || this.used.has(requestId)) throw new Error('Action request ID was already used');
    this.used.add(requestId);
    if (this.used.size > 256) this.used.delete(this.used.values().next().value!);
    return task();
  }
}

export function renderWizardHtml(options: {
  csrfToken: string;
  version: string;
  apkUrl?: string;
  apkQrSvg?: string;
  controlMode?: boolean;
}) {
  const csrf = JSON.stringify(options.csrfToken).replaceAll('<', '\\u003c');
  const routeCards = options.controlMode ? `
    <section class="modes" style="grid-template-columns:1fr">
      <article class="mode"><div class="num">LOCAL / ONLINE</div><h2>本机控制台</h2><p>当前 Hub 与 Tunnel 状态会显示在下方。运行 setup 可重新进入配置或从快速模式升级到固定域名。</p></article>
    </section>` : `
    <section class="modes">
      <article class="mode"><div class="num">STEP 02 / CONNECT · QUICK</div><h2>快速启动</h2><p>无需账号与域名。本机 Hub 通过一次性 Cloudflare 临时隧道上线。</p><button class="button primary" data-action="quick">生成临时连接</button></article>
      <article class="mode"><div class="num">STEP 02 / CONNECT · NAMED</div><h2>深度配置</h2><p>填写固定域名，完成 Cloudflare 授权后自动创建 Named Tunnel 与 DNS。</p><button class="button" data-action="deep">配置固定域名</button></article>
    </section>`;
  const deepPanel = options.controlMode ? '' : `
    <section class="deep" id="deep" hidden>
      <div class="steps"><div class="step active">01 · 域名</div><div class="step">02 · Nameserver</div><div class="step">03 · 授权</div><div class="step">04 · 完成</div></div>
      <div class="fields">
        <label>根域名<input id="rootDomain" placeholder="example.com" autocomplete="off"></label>
        <label>公开地址<input id="hostname" placeholder="dsh.example.com" autocomplete="off"></label>
        <label>Cloudflare NS 1<input id="ns1" placeholder="name.ns.cloudflare.com" autocomplete="off"></label>
        <label>Cloudflare NS 2<input id="ns2" placeholder="name.ns.cloudflare.com" autocomplete="off"></label>
      </div>
      <div class="actions"><button class="button" data-action="save-domain">保存域名</button><button class="button" data-action="check-ns">检查 Nameserver</button><button class="button" data-action="authorize">Cloudflare 授权</button><button class="button primary" data-action="provision">创建固定连接</button></div>
    </section>`;
  const apkCard = options.apkUrl && options.apkQrSvg ? `
    <section class="apk" data-stage="apk">
      <div><div class="num">STEP 01 / DOWNLOAD</div><h2>下载 Community APK</h2><p>先在安卓手机扫码下载安装。Community APK 支持用户确认过的任意 HTTPS Hub，并可与内部版本同时安装。</p><div class="actions"><a class="button" href="${escapeHtml(options.apkUrl)}" target="_blank" rel="noreferrer">下载 APK</a><button class="button" data-action="install-adb">ADB 一键安装</button></div></div>
      <div class="apkqr" aria-label="Community APK download QR">${options.apkQrSvg}</div>
    </section>` : '';
  const pairingCard = `
    <section class="pairing" data-stage="pairing" id="pairing">
      <div class="paircopy"><div class="num">STEP 03 / PAIR</div><h2>连接手机</h2><p id="pairHint">完成上方连接配置后，这里会自动显示一次性互联二维码。</p><div class="pairmeta"><span id="pairStatus">WAITING</span><span id="pairCountdown"></span></div><p class="pairdetail" id="pairDetail">如果 Connector 是首次安装，请重启一次 DSH Web；本页会自动继续检测。</p></div>
      <div class="pairqr waiting" id="pairQr" aria-label="DSH Mobile connection QR"><div class="pairpulse"><span></span><span></span><span></span></div></div>
    </section>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <link rel="icon" href="/favicon.ico">
  <title>DSH EasyRemote · ${options.controlMode ? '本机控制台' : '本机引导'}</title>
  <style>
    :root{--ink:#050708;--panel:#0b0f12;--line:rgba(135,170,188,.18);--text:#edf7fb;--muted:#82949d;--cyan:#54d6ff;--blue:#4a78ff;--ok:#72e5bc;--danger:#ff7d79}
    *{box-sizing:border-box}html{background:var(--ink)}body{margin:0;min-height:100vh;color:var(--text);font-family:"Avenir Next","DIN Alternate","Segoe UI",sans-serif;background:radial-gradient(circle at 70% 15%,rgba(36,113,145,.18),transparent 35%),linear-gradient(145deg,#030506 0%,#081015 54%,#030506 100%);overflow-x:hidden}
    body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.25;background-image:linear-gradient(rgba(93,179,215,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(93,179,215,.05) 1px,transparent 1px);background-size:44px 44px;mask-image:linear-gradient(to bottom,black,transparent 80%)}
    .shell{width:min(1120px,calc(100% - 36px));margin:0 auto;padding:48px 0 70px}.mast{display:grid;grid-template-columns:1.1fr .9fr;gap:34px;align-items:center;min-height:310px;border-bottom:1px solid var(--line)}
    .eyebrow{font:700 11px/1 ui-monospace,SFMono-Regular,monospace;letter-spacing:.24em;color:var(--cyan);text-transform:uppercase}.mast h1{font-size:clamp(42px,7vw,92px);line-height:.91;letter-spacing:-.055em;margin:20px 0 22px;max-width:720px}.mast p{max-width:620px;color:#a3b3ba;font-size:17px;line-height:1.75}
    .sonar{width:min(310px,72vw);aspect-ratio:1;margin:auto;position:relative;display:grid;place-items:center}.ring{position:absolute;border:1px solid rgba(84,214,255,.26);border-radius:50%;animation:pulse 5s ease-in-out infinite}.ring:nth-child(1){inset:4%}.ring:nth-child(2){inset:17%;animation-delay:-1.7s}.ring:nth-child(3){inset:30%;animation-delay:-3.4s}.beam{position:absolute;inset:4%;border-radius:50%;background:conic-gradient(from 10deg,transparent 0 80%,rgba(84,214,255,.18) 96%,transparent);animation:sweep 8s linear infinite}.whale{position:relative;width:108px;height:74px;filter:drop-shadow(0 0 26px rgba(84,214,255,.3));animation:float 4s ease-in-out infinite}.whale:before{content:"";position:absolute;inset:13px 8px 9px 5px;background:#020303;border:2px solid var(--cyan);border-radius:62% 44% 57% 45%/62% 48% 52% 38%;transform:rotate(-7deg)}.whale:after{content:"";position:absolute;width:34px;height:36px;right:-12px;top:4px;border-top:3px solid var(--cyan);border-right:3px solid var(--cyan);transform:rotate(30deg) skew(-18deg);border-radius:0 80% 0 0}
    .modes{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:20px}.mode{position:relative;min-height:260px;padding:30px;border:1px solid var(--line);background:linear-gradient(160deg,rgba(16,24,28,.94),rgba(7,10,12,.9));border-radius:24px;overflow:hidden;transition:.25s transform,.25s border-color}.mode:hover{transform:translateY(-3px);border-color:rgba(84,214,255,.55)}.mode:after{content:"";position:absolute;width:180px;height:180px;border:1px solid var(--line);border-radius:50%;right:-76px;bottom:-92px}.num{font:700 11px/1 ui-monospace,SFMono-Regular,monospace;color:var(--muted);letter-spacing:.18em}.mode h2{font-size:30px;margin:52px 0 10px;letter-spacing:-.03em}.mode p{color:var(--muted);line-height:1.65;min-height:52px}.button{appearance:none;border:1px solid rgba(84,214,255,.45);border-radius:999px;color:var(--text);background:rgba(84,214,255,.08);padding:12px 18px;font:700 14px/1 inherit;cursor:pointer;transition:.2s}.button:hover{background:var(--cyan);color:#031015}.button.primary{background:linear-gradient(100deg,var(--blue),var(--cyan));color:#041014;border:0}.button:disabled{opacity:.45;cursor:wait}
    .deep{margin-top:20px;border:1px solid var(--line);border-radius:24px;padding:28px;background:rgba(4,8,10,.82)}.deep[hidden]{display:none}.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px}.step{border-top:2px solid var(--line);padding-top:10px;color:var(--muted);font:650 12px/1.4 ui-monospace,monospace}.step.active{border-color:var(--cyan);color:var(--text)}.fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}label{display:grid;gap:7px;color:#a9bac1;font-size:13px}input{width:100%;border:1px solid var(--line);border-radius:13px;background:#070b0d;color:var(--text);padding:13px 14px;font:500 15px/1.2 ui-monospace,monospace;outline:none}input:focus{border-color:var(--cyan);box-shadow:0 0 0 3px rgba(84,214,255,.08)}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
    .apk{display:grid;grid-template-columns:1fr 170px;gap:24px;align-items:center;margin-top:20px;border:1px solid var(--line);border-radius:24px;padding:28px;background:linear-gradient(120deg,rgba(74,120,255,.09),rgba(84,214,255,.025))}.apk h2{font-size:28px;margin:18px 0 8px}.apk p{color:var(--muted);line-height:1.6;overflow-wrap:anywhere}.apkqr{background:#fff;border-radius:16px;padding:10px;line-height:0}.apkqr svg{width:100%;height:auto}.apk a{text-decoration:none;display:inline-flex;align-items:center}
    .pairing{display:grid;grid-template-columns:1fr 220px;gap:28px;align-items:center;margin-top:20px;border:1px solid var(--line);border-radius:24px;padding:28px;background:linear-gradient(120deg,rgba(84,214,255,.06),rgba(3,8,11,.9));transition:.3s border-color,.3s box-shadow}.pairing.ready{border-color:rgba(84,214,255,.48);box-shadow:0 0 42px rgba(84,214,255,.08)}.pairing h2{font-size:28px;margin:18px 0 8px}.pairing p{color:var(--muted);line-height:1.6;overflow-wrap:anywhere}.pairmeta{display:flex;gap:14px;margin-top:18px;font:700 11px/1 ui-monospace,monospace;letter-spacing:.12em;color:var(--cyan)}.pairdetail{font-size:12px}.pairqr{width:220px;min-height:220px;border-radius:18px;display:grid;place-items:center;line-height:0;background:rgba(84,214,255,.035);border:1px solid var(--line);overflow:hidden}.pairqr.ready{padding:12px;background:#fff}.pairqr svg{width:100%;height:auto}.pairpulse{position:relative;width:92px;height:92px}.pairpulse span{position:absolute;inset:0;border:1px solid rgba(84,214,255,.4);border-radius:50%;animation:pulse 3s ease-out infinite}.pairpulse span:nth-child(2){animation-delay:-1s}.pairpulse span:nth-child(3){animation-delay:-2s}.pairpulse:after{content:"";position:absolute;inset:35px;border-radius:50%;background:var(--cyan);box-shadow:0 0 24px var(--cyan)}
    .console{margin-top:20px;border-left:2px solid var(--cyan);padding:12px 16px;color:#a9bbc2;background:rgba(84,214,255,.035);font:500 12px/1.65 ui-monospace,SFMono-Regular,monospace;min-height:48px;white-space:pre-wrap}.footer{display:flex;justify-content:space-between;margin-top:24px;color:#60727a;font:600 11px/1.5 ui-monospace,monospace;letter-spacing:.08em}
    @keyframes sweep{to{transform:rotate(360deg)}}@keyframes pulse{50%{transform:scale(1.025);border-color:rgba(84,214,255,.48)}}@keyframes float{50%{transform:translateY(-8px) rotate(-2deg)}}
    @media(max-width:760px){.shell{padding-top:26px}.mast{grid-template-columns:1fr}.sonar{order:-1;width:210px}.modes,.fields,.apk,.pairing{grid-template-columns:1fr}.apkqr{width:170px}.pairqr{width:190px;min-height:190px}.mode{min-height:220px}.mode p{overflow-wrap:anywhere}.steps{grid-template-columns:1fr 1fr}.mast h1{font-size:52px}.footer{align-items:flex-start;flex-direction:column;gap:8px;overflow-wrap:anywhere}}
    @media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
  </style>
</head>
<body>
  <main class="shell">
    <section class="mast">
      <div><div class="eyebrow">Local control plane · v${escapeHtml(options.version)}</div><h1>探索未至之境</h1><p>${options.controlMode ? 'Hub 与 Tunnel 正在这台电脑上运行。关闭本页不会改变已启动的连接。' : 'Hub 始终留在这台电脑。选择临时声道即刻连接，或用固定域名建立一条长期航线。'}</p></div>
      <div class="sonar" aria-label="DSH black whale sonar"><div class="ring"></div><div class="ring"></div><div class="ring"></div><div class="beam"></div><div class="whale"></div></div>
    </section>
    ${apkCard}
    ${routeCards}
    ${deepPanel}
    ${pairingCard}
    <div class="console" id="console" role="status">本机控制面已就绪。请选择连接路径。</div>
    <div class="footer"><span>127.0.0.1 ONLY</span><span>NO SSH · NO REMOTE HUB · NO CLOUDFLARE PASSWORD</span></div>
  </main>
  <script>
    const csrf=${csrf};const out=document.getElementById('console');const deep=document.getElementById('deep');const pairing=document.getElementById('pairing');let pairData=null;
    const values=()=>({rootDomain:document.getElementById('rootDomain')?.value||'',hostname:document.getElementById('hostname')?.value||'',nameservers:[document.getElementById('ns1')?.value||'',document.getElementById('ns2')?.value||'']});
    function renderPairing(data){pairData=data;const qr=document.getElementById('pairQr');const status=document.getElementById('pairStatus');const hint=document.getElementById('pairHint');const detail=document.getElementById('pairDetail');pairing.classList.toggle('ready',Boolean(data.ready));qr.className='pairqr '+(data.ready?'ready':'waiting');status.textContent=String(data.status||'waiting').toUpperCase();if(data.ready){qr.innerHTML=data.qrSvg;hint.textContent=data.recovering?'扫描此二维码，将手机安全重连到当前 Hub。':'打开 Community APK，扫描此二维码完成首次连接。';detail.textContent=(data.nodeName||'DSH')+' · '+(data.hub||'');}else{qr.innerHTML='<div class="pairpulse"><span></span><span></span><span></span></div>';hint.textContent=data.nodeId?'电脑已经连接。需要重连手机时，请在 DSH Web 设置页刷新二维码。':'完成连接配置后，这里会自动显示一次性互联二维码。';detail.textContent=data.error?('Connector：'+data.error):'如果 Connector 是首次安装，请重启一次 DSH Web；本页会自动继续检测。';}renderCountdown();}
    function renderCountdown(){const node=document.getElementById('pairCountdown');if(!pairData?.ready||!pairData.pairingExpiresAt){node.textContent='';return}const remaining=Math.max(0,pairData.pairingExpiresAt-Date.now());node.textContent='EXPIRES '+Math.floor(remaining/60000)+':'+String(Math.floor((remaining%60000)/1000)).padStart(2,'0');}
    async function loadPairing(){try{const response=await fetch('/api/pairing',{credentials:'same-origin',cache:'no-store'});if(response.ok)renderPairing(await response.json());}catch{}}
    async function call(action,body={}){const requestId=crypto.randomUUID();document.querySelectorAll('button').forEach(b=>b.disabled=true);out.textContent='执行 '+action+'…';try{const response=await fetch('/api/'+action,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','x-dsh-csrf':csrf,'x-dsh-request-id':requestId},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||('HTTP '+response.status));out.textContent=data.message||JSON.stringify(data,null,2);if(action==='quick'||action==='named/provision'){pairing.scrollIntoView({behavior:'smooth'});void loadPairing();}return data}catch(error){out.textContent='失败：'+error.message;return null}finally{document.querySelectorAll('button').forEach(b=>b.disabled=false)}}
    document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;if(action==='deep'){deep.hidden=false;deep.scrollIntoView({behavior:'smooth'});return}if(action==='quick')void call('quick');else if(action==='save-domain')void call('named/domain',values());else if(action==='check-ns')void call('named/check-ns',values());else if(action==='authorize')void call('named/authorize',values());else if(action==='provision')void call('named/provision',values());else if(action==='install-adb')void call('apk/install-adb');});
    fetch('/api/state',{credentials:'same-origin'}).then(r=>r.json()).then(data=>{if(deep&&data.progress?.mode==='named'){deep.hidden=false;for(const id of ['rootDomain','hostname'])if(data.progress[id])document.getElementById(id).value=data.progress[id];(data.progress.nameservers||[]).forEach((v,i)=>{const n=document.getElementById('ns'+(i+1));if(n)n.value=v});}if(data.message)out.textContent=data.message}).catch(()=>{});
    loadPairing();setInterval(loadPairing,2000);setInterval(renderCountdown,1000);
  </script>
</body></html>`;
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export type WizardAction = (body: Record<string, unknown>) => Promise<unknown>;

export async function startWizardServer(options: {
  version: string;
  getState: () => Promise<unknown>;
  getPairing?: () => Promise<LocalPairingState | null> | LocalPairingState | null;
  actions: Record<string, WizardAction>;
  apkUrl?: string;
  controlMode?: boolean;
}) {
  const secrets = createWizardSecrets();
  const gate = new WizardActionGate();
  let bootstrapConsumed = false;
  const apkUrl = options.apkUrl ?? 'https://github.com/hakimedes/dsh-easyremote/releases/latest/download/DSH-EasyRemote-Community.apk';
  const apkQrSvg = await QRCode.toString(apkUrl, { type: 'svg', margin: 1, width: 180 });
  let expectedHost = '';
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
      if (request.method === 'GET' && url.pathname === '/'
        && request.headers.host === expectedHost
        && !bootstrapConsumed
        && url.searchParams.get('session') === secrets.sessionToken) {
        bootstrapConsumed = true;
        response.writeHead(303, {
          location: '/',
          'set-cookie': `${SESSION_COOKIE}=${secrets.sessionToken}; HttpOnly; SameSite=Strict; Path=/`,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        response.end();
        return;
      }

      const authorization = authorizeWizardRequest({
        method: request.method || 'GET',
        host: request.headers.host,
        expectedHost,
        sessionToken: secrets.sessionToken,
        csrfToken: secrets.csrfToken,
        cookie: request.headers.cookie,
        csrf: headerValue(request, 'x-dsh-csrf'),
        origin: request.headers.origin,
      });
      if (!authorization.ok) return sendJson(response, authorization.status, { error: authorization.message });

      if (['GET', 'HEAD'].includes(request.method || '') && url.pathname === '/favicon.ico') {
        response.writeHead(204, {
          'cache-control': 'public, max-age=86400',
          'x-content-type-options': 'nosniff',
        });
        response.end();
        return;
      }
      if (request.method === 'GET' && url.pathname === '/') {
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
        });
        response.end(renderWizardHtml({ csrfToken: secrets.csrfToken, version: options.version, apkUrl, apkQrSvg, controlMode: options.controlMode }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/state') {
        return sendJson(response, 200, await options.getState());
      }
      if (request.method === 'GET' && url.pathname === '/api/pairing') {
        const pairing = await options.getPairing?.() ?? null;
        const live = pairing?.qrPayload && pairing.pairingExpiresAt && pairing.pairingExpiresAt > Date.now();
        const qrSvg = live ? await QRCode.toString(pairing.qrPayload!, { type: 'svg', margin: 1, width: 220 }) : '';
        return sendJson(response, 200, {
          ready: Boolean(qrSvg),
          status: pairing?.status ?? 'waiting',
          hub: pairing?.hub ?? null,
          nodeName: pairing?.nodeName ?? null,
          nodeId: pairing?.nodeId ?? null,
          recovering: Boolean(pairing?.nodeId && qrSvg),
          qrSvg,
          pairingExpiresAt: qrSvg ? pairing?.pairingExpiresAt ?? null : null,
          error: pairing?.error ?? null,
        });
      }
      if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
        const actionName = url.pathname.slice('/api/'.length);
        const action = options.actions[actionName];
        if (!action) return sendJson(response, 404, { error: 'Unknown wizard action' });
        const requestId = headerValue(request, 'x-dsh-request-id');
        if (!requestId) return sendJson(response, 400, { error: 'Action request ID required' });
        const body = await readJsonBody(request);
        const result = await gate.run(requestId, () => action(body));
        return sendJson(response, 200, result ?? { ok: true });
      }
      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(wizardListenOptions(), () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Wizard failed to bind to loopback');
  expectedHost = `127.0.0.1:${address.port}`;
  const origin = `http://${expectedHost}`;
  return {
    origin,
    launchUrl: `${origin}/?session=${encodeURIComponent(secrets.sessionToken)}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function headerValue(request: IncomingMessage, name: string) {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  if (response.headersSent) return;
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function readJsonBody(request: IncomingMessage, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body is too large'));
        request.destroy();
      } else chunks.push(chunk);
    });
    request.once('error', reject);
    request.once('end', () => {
      try {
        if (!chunks.length) return resolve({});
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON body must be an object');
        resolve(value as Record<string, unknown>);
      } catch (error) {
        reject(error);
      }
    });
  });
}
