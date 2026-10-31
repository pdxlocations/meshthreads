# MeshThreads

A compact threaded message board for Meshtastic with Harbor light and dark themes. Built from
[Firefly](https://github.com/pdxlocations/firefly), preserving its Flask,
Socket.IO, SQLite, vnode, meshdb, and UDP multicast backend.

## Run

Python 3.11–3.14 is supported. From this folder:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python start.py
```

Open **http://localhost:5069**. Create an account, open **Configure profiles**,
create a profile with your existing mesh channel name and PSK, then activate it.
The app discovers nodes through Meshtastic UDP multicast; it does not connect
to a radio over Bluetooth or serial. Match the multicast group/port and mesh
channel settings used by your network, as in Firefly.

The local `.venv` is installed during initial setup when dependencies are available.
The application starts with a fresh database. No Firefly accounts, messages,
profile identities, private keys, or `.env` files were copied.

## Board and rooms

- Rooms on the left, threaded board in the center, nodes on the right.
- Every top-level message starts a thread. Replies use standard Meshtastic
  `reply_id` packet metadata, expand inline, and bump the original thread to the
  top. Replies to replies remain under the same original post.
- Channel history includes older posts so a recent reply can restore an old
  thread. If an original was never received or its history was cleared, the
  board labels the missing original and groups the available replies.
- **New room** creates a channel on the active profile with a cryptographically
  random 32-byte PSK. Room names allow up to 12 UTF-8 bytes.
- **Room settings** lets you rename a channel, rotate its PSK, copy its standard
  Meshtastic URL, or leave it. Keep at least one channel on each profile.
  Changing the name or key changes the mesh channel; share the new URL with
  participants. Leaving preserves stored history.
- **Invite to room** in either node list opens a room picker. Any participant
  can invite a node to any room on their active profile. The invitation is a
  DM containing a standard Meshtastic channel URL with the PSK.
- Received DM invitations show **Join room**. Acceptance explicitly adds the
  room to the recipient’s active profile; repeated acceptance reopens it.
  Links containing multiple channels are rejected to avoid importing unrelated
  channels or changing radio settings.
- Star nodes in either node list to keep them at the top. Favorites persist
  with your account across sessions and profiles. DM conversation headers show
  the active person’s name and node ID.
- DMs, delivery status/retry, node details, node-info exchange, traceroute, map,
  multiple profiles, notifications, accounts, passwords, and account deletion
  retain Firefly’s workflows. A successful invitation submission means queued
  for transmission; check its ACK/delivery status in DMs.

On narrower screens the node rail is hidden; **Nodes** still provides the node
list and invitation controls. On phones, Rooms & navigation opens a compact drawer so the board uses the full screen width. The sidebar shows the active profile and Web/Mesh status; tap the profile name to open Profiles. Activation and deactivation live on profile cards, with the accent-colored action. Activating a profile opens its first channel. Login automatically activates the profile and opens messages when the account has exactly one profile; other accounts open Profiles. Tapping the header account name closes the mobile drawer.

The compact Harbor interface uses locally bundled Nunito Sans, soft blue-gray panels and teal accents, with profile and room panels on the left, inline threads in the center, and nodes on the right. Use the sun/moon icon to the left of your user menu to switch between light and dark modes. Your choice is remembered in this browser. Bootstrap, Socket.IO client, and Leaflet retain Firefly’s CDN
loading requirements.

## Configuration and Docker

Firefly’s `FIREFLY_*` environment variables remain supported. Defaults use
web port **5069**, multicast **239.0.0.69:4403**, local `firefly.db`, and
`firefly_runtime/` inside this checkout. These files are ignored by Git.

```sh
docker compose up --build
```

The Compose service/container/volume are named for MeshThreads to keep them
separate from Firefly. Linux host networking preserves UDP multicast behavior.
For other networking modes, see [Docker notes](DOCKER.md).

To migrate an existing Firefly installation intentionally, stop it and back up
its database **and matching runtime identity directory together**. Configure
`FIREFLY_DATABASE_FILE` and `FIREFLY_RUNTIME_DIR` to point to the copied pair.
Never share a live database between the two apps or run the same node identity
in both at once. Identity migration and original Firefly configuration details
are documented in [the upstream README](docs/FIREFLY.md).

Expanded node details also show the latest stored telemetry by category and an interactive map of the last reported position. Missing readings are omitted, and every metrics category and position has its own update time. Readings use the [Meshtastic telemetry definitions](https://github.com/meshtastic/protobufs/blob/master/meshtastic/telemetry.proto). Telemetry is loaded on expansion and refreshed while the directory updates; it does not request extra telemetry over the radio.

Latest completed traceroutes are saved per profile and destination node. Expand a node in the directory to see the last received route in both directions, its signal values, and receipt time. Saved routes survive restarts; new responses replace the previous route for that node.

Unread room counts, thread badges, and New labels highlight unread activity. A channel is marked read after all its loaded unread messages have been visible in a focused tab; collapsed and offscreen replies keep the channel unread. The mobile navigation button includes the total unread count.

## Checks

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
node --test tests/test_*.js
```

Tests cover the inherited identity/channel routing/message snapshot behavior,
thread bumping and ancestry, malformed/missing reply parents, compatible
channel URL encoding, random PSKs, room joining/management, and DM invitations.
Radio transport is mocked for room API tests; end-to-end hardware delivery
requires a reachable Meshtastic network and the recipient’s public key.

Meshtastic’s standard link encoding uses a protobuf `ChannelSet`; see the
[official Python API](https://python.meshtastic.org/node.html).

## Receive diagnostics

While signed in, open `/api/network-status` to inspect receiver status, counts
by channel and decoded port, undecodable packet counts, and listener errors.
`inbound_by_port` excludes locally sent packets echoed over UDP;
`local_echoes_by_port` reports those separately.
The endpoint excludes message bodies and PSKs. Counters reset when the app
restarts. For MeshOregon, compare received traffic against your configured
channel hash. Port 1 is text, port 4 is node info, and port 70 is traceroute.
Node-info and traceroute requests choose a channel where the destination was
discovered, even when a different private room is open. Their status messages
name the channel used. If no new inbound packets arrive during a reply test,
check UDP delivery.
If packets arrive but remain undecodable on a configured channel, check that
its name and PSK match the radio. Browser reconnects refresh stored history
so messages received during a connection interruption reappear.

## License

This is a Firefly derivative; the original [GPLv3 license](LICENSE) is retained.
Nunito Sans has its own [OFL license](static/fonts/OFL-NunitoSans.txt).
