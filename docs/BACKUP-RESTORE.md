# Backup and Restore

## Create a backup

```bash
dsh-easyremote backup
```

The CLI uses SQLite's online backup API and writes a dated backup directory under `~/.dsh-easyremote/backups/`. Tunnel credentials, Cloudflare account certificates, logs and Android signing material are deliberately excluded.

Copy backups to encrypted storage. A backup contains Hub, Owner, Node and session-index metadata and should be treated as sensitive.

## Restore

Stop the service, then provide an explicit backup path:

```bash
dsh-easyremote stop
dsh-easyremote restore /absolute/path/to/backup-directory
dsh-easyremote start
```

Restore refuses to overwrite a running database, requires the selected directory to contain `hub.sqlite`, and keeps the install's external Cloudflare resources unchanged. Only restore backups you created or trust.

## Quick-to-Named migration

No manual database migration is needed. Running `dsh-easyremote setup` and choosing Deep Configuration retains the same database and `hubId` while replacing the public origin.
