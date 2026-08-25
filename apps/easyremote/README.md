# DSH EasyRemote

DSH EasyRemote keeps its Hub on your computer and connects the Community Android
app through a Cloudflare Tunnel. It is an independent community project and is
not affiliated with or endorsed by DeepSeek.

```bash
npx @hakimedes/dsh-easyremote
```

The first run opens a localhost-only setup wizard. Choose **Quick Start** for a
temporary `trycloudflare.com` address, or **Deep Configuration** for a fixed
hostname and a user-login service. The program never requests an SSH password,
Cloudflare password, registrar password, or inbound firewall port.

See the repository README for the complete security model, Android download,
backup, recovery, and troubleshooting guide.
