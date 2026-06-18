# Deploy / infra notes

Reverse-proxy and process-manager config for `jenkins-chat-approval`, kept in
version control so the routing can't silently disappear again.

## Routing

The app listens on `127.0.0.1:8081` (plain HTTP) and is fronted by nginx on
`deployments.cred2tech.com`, which terminates TLS (Let's Encrypt / Certbot):

| Public URL                                             | Upstream            |
| ------------------------------------------------------ | ------------------- |
| `https://deployments.cred2tech.com/`                   | Jenkins `:8080`     |
| `https://deployments.cred2tech.com/chat-approval/...`  | this app `:8081`    |

The `/chat-approval/` prefix is **stripped** before forwarding (trailing slash
on `proxy_pass`), because the app mounts routes at root: `POST /`, `POST /notify`,
`POST /post`, `GET /healthz`. This must stay in sync with `CHAT_ACTION_URL` in
`/etc/cred2tech/jenkins-chat-approval.env`.

nginx vhost: [`nginx/deployments.cred2tech.com.conf`](nginx/deployments.cred2tech.com.conf)

## Health checks

```bash
curl -s http://127.0.0.1:8081/healthz                              # app direct
curl -s https://deployments.cred2tech.com/chat-approval/healthz    # through nginx+TLS
# both -> {"ok":true}
```

## PM2

The app runs under root's PM2 (`pm2 list` -> `jenkins-chat-approval`, id 4).
To survive reboots, PM2 must have a systemd unit installed and a saved process
list:

```bash
pm2 startup systemd -u root --hp /root   # run the command it prints, if any
pm2 save                                 # snapshot current online processes
```

If PM2 ever comes back empty after a reboot/crash, restore from the on-disk
dump (do NOT `pm2 save` first, or you overwrite the dump with an empty list):

```bash
pm2 resurrect
```

## History / gotcha

`502 Bad Gateway` on `/chat-approval/` has had two distinct causes:

1. A separate `jenkins` nginx vhost that held this route got blanked to 0 bytes,
   removing the proxy entry. Fixed by folding the `/chat-approval/` location into
   `deployments.cred2tech.com.conf` and deleting the empty `jenkins` vhost. Do
   not recreate a separate `jenkins` vhost.
2. The PM2 daemon died and came back empty (no `pm2 startup` configured), so
   nothing listened on `:8081`. Fixed with `pm2 resurrect` + `pm2 startup`/`save`.
