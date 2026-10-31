# MeshThreads with Docker

From this checkout:

```sh
docker compose up --build -d
docker compose logs -f meshthreads
```

Open http://localhost:5069. The image builds from this folder. The service is
`meshthreads`, container `meshthreads-app`, and persistent Compose volume
`meshthreads_data` (Compose adds its project prefix to the actual volume name).
The app’s database and runtime identity files are stored together in `/app/data`.

The default Compose file uses Linux host networking for Meshtastic UDP multicast.
On macOS, the native Python runner is the simplest way to give the app direct
access to your LAN’s multicast traffic. Docker Desktop networking must support
and forward the multicast traffic for node discovery and messaging to work.

For bridge networking, follow the commented port mappings in
[docker-compose.yml](docker-compose.yml) and set `NETWORK_MODE=bridge`. Mapping
a UDP port alone does not guarantee LAN multicast delivery.

Configuration retains Firefly’s `FIREFLY_*` environment variables:

- `FIREFLY_PORT` / `FIREFLY_WEB_PORT`: default `5069`.
- `FIREFLY_DATABASE_FILE`: default `/app/data/mudpchat.db` in Docker.
- `FIREFLY_MCAST_GRP` / `FIREFLY_UDP_PORT`: default `239.0.0.69` / `4403`.
- `FIREFLY_SECRET_KEY`: optional; otherwise generated persistently.

If changing the internal web port, update the Dockerfile and Compose healthcheck
URL to match it.

```sh
docker compose stop
docker compose up --build -d
docker compose exec meshthreads /bin/bash
```

Back up the whole data volume while stopped, including both database and runtime
identity files. Keep the database and its identity directory together during
restores. Do not run a restored identity simultaneously in Firefly and MeshThreads.
See [README.md](README.md) for native setup and app usage.
