# DSH EasyRemote Connector

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
dsh plugin --profile web add /absolute/path/to/hakimedes-dsh-easyremote-connector-0.3.4.tgz
```

The package declares `dsh.bundle.patch`, so `dsh plugin add` registers the
bundle in the profile automatically. Do not add the Connector to the user's
`$DSH_HOME/profiles/web/cordis.patch.yml`; that file remains the user's final
override layer.

Restart `dsh web`, then open **Settings → Remote** to scan or refresh the
one-time QR. The standalone fallback is the URL printed by DSH with
`/__dsh_remote_v1/pair` appended.

If Mobile has lost its local credential while this node is still connected,
open the same page and select **Reconnect mobile**. The authenticated connector
will issue a one-time recovery QR without replacing or duplicating the node.

See the repository `docs/DEPLOYMENT.md` for complete deployment, upgrade, and
troubleshooting instructions.
