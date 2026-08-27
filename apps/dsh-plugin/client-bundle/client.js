/**
 * @hakimedes/dsh-easyremote-connector — browser client half.
 *
 * Speaks the dsh module-loader protocol consumed by the client-modules boot
 * graph: the whole file is one `window.__ModuleLoader__.load({ id, factory })`
 * call whose factory receives a `require` that answers the platform seed rows
 * ('react' family, cordis, ui-primitives). Everything else stays
 * self-contained so this ships as a single static artifact with no bundler:
 * `scripts/build-client.mjs` copies it verbatim to lib/client.js, which the
 * package exposes as exports["./client"] and declares via package.json
 * `dsh.client`. The banner id MUST equal the npm package name.
 *
 * Contributes one additive settings page (`settings.section`, id "dsh-remote")
 * so remote connection lives inside DSH Web's Settings panel instead of only
 * at the standalone /__dsh_remote_v1/pair URL: live connection status, the
 * one-time pairing QR while unpaired, mobile recovery when connected, and a
 * link out to the full page. Data comes from same-origin
 * GET /__dsh_remote_v1/pair-data; recovery POSTs /__dsh_remote_v1/recover.
 */
window.__ModuleLoader__.load({ id: '@hakimedes/dsh-easyremote-connector', factory: (require) => {
  var module = { exports: {} };
  var exports = module.exports;

  var React = require('react');

  var DATA_URL = '/__dsh_remote_v1/pair-data';
  var RECOVER_URL = '/__dsh_remote_v1/recover';
  var PAIR_PAGE_URL = '/__dsh_remote_v1/pair';
  var POLL_MS = 4000;
  var STYLE_ID = 'dsh-remote-connector-css';

  var TONE_COLOR = {
    success: 'var(--dsw-alias-state-success-primary,#4ade80)',
    warn: 'var(--dsw-alias-state-warn-primary,#fbbf24)',
    error: 'var(--dsw-alias-state-error-primary,#f87171)',
    neutral: 'var(--dsw-alias-label-secondary,#9da7b3)',
  };

  var TONE_BY_STATUS = {
    online: 'success',
    pairing: 'warn',
    connecting: 'warn',
    starting: 'neutral',
    offline: 'error',
    revoked: 'error',
  };

  var CSS_TEXT = [
    '.dsh-remote-section{display:flex;flex-direction:column;gap:14px;max-width:600px;}',
    '.dsh-remote-card{border:1px solid var(--dsw-alias-border-l1,#30363d);border-radius:12px;',
    'background:var(--dsw-alias-bg-layer-1,#161b22);padding:16px;display:flex;flex-direction:column;gap:12px;}',
    '.dsh-remote-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}',
    '.dsh-remote-title{font-size:13px;font-weight:700;letter-spacing:.02em;text-transform:uppercase;',
    'color:var(--dsw-alias-label-secondary,#9da7b3);}',
    '.dsh-remote-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:2px 10px;',
    'font-size:11px;font-weight:700;background:var(--dsw-alias-bg-layer-2,#21262d);white-space:nowrap;}',
    '.dsh-remote-dot{width:7px;height:7px;border-radius:4px;background:currentColor;}',
    '.dsh-remote-meta{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none;}',
    '.dsh-remote-meta li{display:flex;gap:8px;font-size:12px;line-height:18px;min-width:0;}',
    '.dsh-remote-k{flex:none;width:64px;color:var(--dsw-alias-label-secondary,#9da7b3);}',
    '.dsh-remote-v{color:var(--dsw-alias-label-primary,#f4f5f7);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.dsh-remote-qrbox{align-self:center;background:#fff;border-radius:14px;padding:14px;line-height:0;max-width:100%;}',
    '.dsh-remote-qrbox svg{width:232px;height:232px;max-width:100%;}',
    '.dsh-remote-count{align-self:center;font-size:12px;color:var(--dsw-alias-label-secondary,#9da7b3);}',
    '.dsh-remote-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#9da7b3);margin:0;}',
    '.dsh-remote-warn{display:flex;gap:8px;align-items:flex-start;font-size:12px;line-height:18px;border-radius:9px;',
    'padding:10px 12px;background:var(--dsw-alias-bg-layer-2,#21262d);color:var(--dsw-alias-state-warn-primary,#fbbf24);}',
    '.dsh-remote-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}',
    '.dsh-remote-btn{appearance:none;border:0;border-radius:10px;padding:9px 16px;font:600 13px system-ui;cursor:pointer;',
    'background:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff;}',
    '.dsh-remote-btn:disabled{opacity:.55;cursor:default;}',
    '.dsh-remote-link{font-size:12px;font-weight:600;color:var(--dsw-alias-brand-primary,#4d6bfe);text-decoration:none;}',
  ].join('');

  function ensureStyles() {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    var tag = document.createElement('style');
    tag.id = STYLE_ID;
    tag.textContent = CSS_TEXT;
    document.head.appendChild(tag);
  }

  function Pill(_ref) {
    var label = _ref.label;
    var tone = TONE_COLOR[TONE_BY_STATUS[label] ? TONE_BY_STATUS[label] : 'neutral'];
    return React.createElement(
      'span',
      { className: 'dsh-remote-pill', style: { color: tone } },
      React.createElement('span', { className: 'dsh-remote-dot' }),
      String(label || ''),
    );
  }

  function MetaRow(key, value) {
    return React.createElement(
      'li',
      null,
      React.createElement('span', { className: 'dsh-remote-k' }, key),
      React.createElement('span', { className: 'dsh-remote-v', title: String(value) }, String(value)),
    );
  }

  function formatRemaining(expiresAt, now) {
    if (!expiresAt) return '';
    var remaining = Math.max(0, expiresAt - now);
    var m = Math.floor(remaining / 60000);
    var s = Math.floor((remaining % 60000) / 1000);
    return m + ':' + String(s).padStart(2, '0');
  }

  function RemoteSection(props) {
    var _React$useState = React.useState(null);
    var data = _React$useState[0];
    var setData = _React$useState[1];

    var _React$useState2 = React.useState(true);
    var busy = _React$useState2[0];
    var setBusy = _React$useState2[1];

    var _React$useState3 = React.useState(null);
    var actionError = _React$useState3[0];
    var setActionError = _React$useState3[1];

    var _React$useState4 = React.useState(Date.now());
    var now = _React$useState4[0];
    var setNow = _React$useState4[1];

    React.useEffect(function () {
      var alive = true;
      async function load() {
        try {
          var res = await fetch(DATA_URL, { cache: 'no-store' });
          var next = await res.json();
          if (alive && next && next.ok) {
            setData(next);
            setBusy(false);
          }
        } catch (error) { /* keep last state; next poll retries */ }
      }
      load();
      var poll = setInterval(load, POLL_MS);
      var beat = setInterval(function () { setNow(Date.now()); }, 1000);
      return function () {
        alive = false;
        clearInterval(poll);
        clearInterval(beat);
      };
    }, []);

    async function recover() {
      setBusy(true);
      setActionError(null);
      try {
        var res = await fetch(RECOVER_URL, { method: 'POST' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var next = await fetch(DATA_URL, { cache: 'no-store' }).then(function (r) { return r.json(); });
        if (next && next.ok) setData(next);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    }

    var qrSvg = data && typeof data.qrSvg === 'string' ? data.qrSvg : '';
    var status = data ? String(data.status || '') : '';

    return React.createElement(
      'div',
      { className: 'dsh-remote-section' },
      React.createElement(
        'div',
        { className: 'dsh-remote-card' },
        React.createElement(
          'div',
          { className: 'dsh-remote-head' },
          React.createElement('span', { className: 'dsh-remote-title' }, 'Remote connection'),
          data ? React.createElement(Pill, { label: status }) : null,
        ),
        !data
          ? React.createElement('p', { className: 'dsh-remote-note' }, 'Loading remote state…')
          : React.createElement(
            React.Fragment,
            null,
            React.createElement(
              'ul',
              { className: 'dsh-remote-meta' },
              MetaRow('Node', data.nodeName || '—'),
              MetaRow('Hub', data.hub || '—'),
              MetaRow('Node ID', data.nodeId || 'Not paired yet'),
            ),
            qrSvg
              ? React.createElement(
                React.Fragment,
                null,
                React.createElement('div', {
                  className: 'dsh-remote-qrbox',
                  // Server-rendered SVG from our own connector route (qrcode lib output).
                  dangerouslySetInnerHTML: { __html: qrSvg },
                }),
                React.createElement('div', { className: 'dsh-remote-count' },
                  data.pairingExpiresAt
                    ? 'Expires in ' + formatRemaining(data.pairingExpiresAt, now) + ' · one-time use'
                    : null),
                React.createElement('p', { className: 'dsh-remote-note' },
                  data.recovering
                    ? 'Scan this QR with DSH Mobile on a phone that was paired before to restore access.'
                    : 'Scan this QR with DSH Mobile to pair this Harness as a remote node.'),
              )
            : data.nodeId
              ? React.createElement('p', { className: 'dsh-remote-note' },
                'Remote access is active. Revoke this node from Nodes in the mobile app.')
            : React.createElement('div', { className: 'dsh-remote-warn' },
              React.createElement('span', null,
                data.error
                  ? 'Hub unreachable — retrying in the background. Last error: ' + data.error
                  : 'Preparing a pairing QR…')),
            actionError
              ? React.createElement('div', { className: 'dsh-remote-warn' },
                React.createElement('span', null, 'Recovery failed: ' + actionError))
            : null,
            data.nodeId
              ? React.createElement(
                'div',
                { className: 'dsh-remote-actions' },
                React.createElement('button', {
                  className: 'dsh-remote-btn',
                  disabled: busy,
                  onClick: function () { void recover(); },
                }, busy ? 'Refreshing…' : qrSvg ? 'Refresh connection QR' : 'Generate connection QR'),
                React.createElement('span', { className: 'dsh-remote-note' },
                  qrSvg
                    ? 'The previous QR expires immediately when a new one is generated.'
                    : 'Generate a one-time QR to reconnect DSH Mobile.'),
              )
            : null,
          ),
      ),
      React.createElement(
        'div',
        { className: 'dsh-remote-actions' },
        React.createElement('a', { className: 'dsh-remote-link', href: PAIR_PAGE_URL, target: '_blank', rel: 'noreferrer' },
          'Open standalone pair page ↗'),
      ),
    );
  }

  module.exports = {
    inject: ['slots'],
    apply: function apply(ctx) {
      ensureStyles();
      var slots = ctx.get('slots');
      if (slots === undefined) return;
      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'dsh-remote', order: 30, label: 'Remote' },
          RemoteSection,
        );
      });
    },
  };

  return module.exports;
} });
