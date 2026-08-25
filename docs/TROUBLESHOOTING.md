# Troubleshooting

Start with:

```bash
dsh-easyremote status
dsh-easyremote doctor
```

| Symptom | Action |
| --- | --- |
| Quick Tunnel has no URL | Confirm outbound HTTPS access, rerun `quick`, and inspect `~/.dsh-easyremote/logs/cloudflared.log`. The installer uses an isolated empty config. |
| Deep setup waits on NS | Compare the two expected Cloudflare Nameservers with public DNS. Remove stale DNSSEC/DS records at the registrar if Cloudflare reports them. Propagation can take hours. |
| Tunnel name already exists | Verify the browser authorized the intended Cloudflare account. Re-enter setup; the installer reuses a matching local Tunnel ID and does not delete unknown tunnels. |
| Fixed hostname has a DNS conflict | Remove or rename the conflicting A/AAAA/CNAME record in Cloudflare, then retry the DNS route step. |
| Connector stays offline | Restart DSH, inspect `~/.dsh-easyremote/connector.json`, and check that its `hubUrl` equals `status` output. |
| Phone remains on pairing screen | Generate a fresh one-time recovery QR from the current setup/control page. Expired tokens cannot be reused. |
| Hub ID mismatch | Do not proceed unless this is an intentional new installation. Sign out before changing Hub; a recovery QR is valid only for the same Hub identity. |
| Service does not start after login | Run `doctor`; inspect LaunchAgent, `systemctl --user status dsh-easyremote`, or the current user's scheduled task. No root service is installed. |
| Port is occupied | Restart through the CLI. It selects a free loopback port, persists it and rewrites the Tunnel target. |
| Android one-click install fails | Run `adb devices`, unlock the phone, accept the USB debugging prompt and ensure exactly one device is authorized. |

Never post `install.json`, databases, `cert.pem`, Tunnel credential JSON, Pair Tokens or full logs containing tokens in a public issue.
