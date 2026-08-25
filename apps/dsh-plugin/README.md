# DSH Remote Hub Connector

Host-side plugin for DeepSeek Harness (`dsh`) 0.1.0-rc.6. It keeps one outbound
WebSocket connection to a DSH Remote Hub and exposes session list, snapshot,
create, follow-up, steer, stop, event streaming, and allow-once/deny approval.

The node credential is stored with owner-only permissions at:

```text
$DSH_HOME/remote-hub/node-identity.json
```

## Configuration

Set these variables in the environment that starts DSH:

```bash
export DSH_REMOTE_HUB_URL=https://dsh.example.com
export DSH_REMOTE_NODE_NAME='My workstation'
# Optional: working directory for sessions created from Mobile.
export DSH_REMOTE_DEFAULT_CWD=/absolute/path/to/project
```

`DSH_REMOTE_HUB_URL` must be the same public HTTPS origin compiled into the
Mobile APK. Do not expose the local DSH Web port to the internet; this plugin
only needs outbound HTTPS/WSS access to Hub.

## Install into a DSH profile

Install the packaged `.tgz` from this repository:

```bash
dsh plugin --profile web add /absolute/path/to/dsh-remote-hub-connector-0.1.1.tgz
```

Then add this entry to `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-remote-hub-connector
      name: '@dsh-remote/hub-connector'
```

Restart `dsh web`, open the URL printed by DSH, append
`/__dsh_remote_v1/pair`, and scan the QR with DSH Mobile.

If Mobile has lost its local credential while this node is still connected,
open the same page and select **Reconnect mobile**. The authenticated connector
will issue a one-time recovery QR without replacing or duplicating the node.

See the repository `docs/DEPLOYMENT.md` for complete deployment, upgrade, and
troubleshooting instructions.
