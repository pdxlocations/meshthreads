"""Room management layered on Firefly profiles and its existing DM transport."""
import base64
import binascii
import secrets
from urllib.parse import urlsplit

from flask import jsonify, request
from google.protobuf.message import DecodeError
from meshtastic.protobuf import apponly_pb2


def validate_channel(channel):
    name = str(channel.get('name', '')).strip()
    if not name or len(name.encode('utf-8')) > 12:
        raise ValueError('Room name must be 1–12 UTF-8 bytes.')
    key = str(channel.get('key', '')).strip().replace('-', '+').replace('_', '/')
    try:
        raw = base64.b64decode(key, validate=True)
    except (ValueError, binascii.Error):
        raise ValueError('PSK must be valid base64.') from None
    if len(raw) not in (1, 16, 32):
        raise ValueError('PSK must contain 1, 16, or 32 bytes.')
    return {'name': name, 'key': base64.b64encode(raw).decode()}


def channel_url(channel):
    channel = validate_channel(channel)
    payload = apponly_pb2.ChannelSet()
    settings = payload.settings.add()
    settings.name = channel['name']
    settings.psk = base64.b64decode(channel['key'])
    token = base64.urlsafe_b64encode(payload.SerializeToString()).decode().rstrip('=')
    return 'https://meshtastic.org/e/#' + token


def parse_channel_url(value):
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError('Enter a Meshtastic channel URL.')
    url = urlsplit(value.strip())
    if url.scheme != 'https' or url.netloc != 'meshtastic.org' or url.path not in ('/e/', '/d/') or not url.fragment:
        raise ValueError('Enter a https://meshtastic.org/e/#… channel URL.')
    try:
        token = url.fragment
        raw = base64.b64decode(token + '=' * (-len(token) % 4), altchars=b'-_', validate=True)
        payload = apponly_pb2.ChannelSet()
        payload.ParseFromString(raw)
    except (ValueError, binascii.Error, DecodeError):
        raise ValueError('Invalid Meshtastic channel URL.') from None
    if len(payload.settings) != 1:
        raise ValueError('Invite links must contain exactly one room.')
    settings = payload.settings[0]
    return validate_channel({'name': settings.name, 'key': base64.b64encode(settings.psk).decode()})


def public_channels_from_profiles(profiles):
    """Return only explicit one-byte PSKs; never publish private profile data."""
    found = set()
    for profile in profiles.values():
        channels = profile.get('channels')
        if not isinstance(channels, list):
            channels = [{'name': profile.get('channel'), 'key': profile.get('key')}]
        for channel in channels:
            try:
                normalized = validate_channel(channel)
            except (ValueError, AttributeError, TypeError):
                continue
            if len(base64.b64decode(normalized['key'])) == 1:
                found.add((normalized['name'], normalized['key']))
    return [{'name': name, 'key': key} for name, key in sorted(found, key=lambda item: (item[0].casefold(), item))]


def register_room_routes(api):
    app = api['app']
    login_required = api['login_required']

    def body():
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            raise ValueError('Request must be a JSON object.')
        return data

    def profile():
        active = api['_get_session_profile']()
        if not active:
            raise ValueError('Select an active profile first.')
        return active

    def save(active, channels, selected=0):
        if not channels:
            raise ValueError('Keep at least one room on this profile.')
        manager = api['profile_manager']
        if not manager.update_profile(active['id'], api['_get_session_user']()['id'], active['node_id'],
                                      active['long_name'], active['short_name'], channels, active.get('hop_limit', 3)):
            raise RuntimeError('Could not save rooms.')
        updated = manager.get_profile(active['id'], user_id=api['_get_session_user']()['id'])
        api['ensure_profile_config'](updated, api['MCAST_GRP'], api['MCAST_PORT'])
        api['_seed_profile_mesh_identity'](updated)
        api['_set_session_profile'](updated)
        api['_set_session_channel_index'](selected)
        return jsonify(profile=api['_serialize_profile_for_client'](updated), selected_channel_index=selected)

    def selected(active, index):
        channels = api['_profile_channels'](active)
        if not 0 <= index < len(channels):
            raise ValueError('Room not found.')
        return channels

    @app.route('/api/rooms/public-channels', methods=['GET'])
    @login_required
    def detect_public_channels():
        # This is intentionally shared across accounts, but only public keys
        # and channel names leave the server. No owner/profile metadata does.
        from channel_discovery import public_channel_fingerprint
        verified = api['db'].get_verified_public_channel_fingerprints()
        channels = [channel for channel in public_channels_from_profiles(api['profile_manager'].get_all_profiles())
                    if public_channel_fingerprint(channel) in verified]
        return jsonify(channels=channels)

    @app.route('/api/rooms', methods=['POST'])
    @login_required
    def create_room():
        try:
            active = profile()
            data = body()
            channel = parse_channel_url(data['url']) if 'url' in data else validate_channel({
                'name': data.get('name', ''),
                'key': data.get('key') or base64.b64encode(secrets.token_bytes(32)).decode(),
            })
            channels = api['_profile_channels'](active)
            for index, existing in enumerate(channels):
                if existing == channel:
                    return save(active, channels, index)
            channels.append(channel)
            return save(active, channels, len(channels) - 1)
        except ValueError as error:
            return jsonify(error=str(error)), 400

    @app.route('/api/rooms/<int:index>', methods=['GET', 'PUT', 'DELETE'])
    @login_required
    def manage_room(index):
        try:
            active = profile()
            channels = selected(active, index)
            if request.method == 'GET':
                return jsonify(name=channels[index]['name'], url=channel_url(channels[index]))
            if request.method == 'DELETE':
                channels.pop(index)
                return save(active, channels, 0)
            data = body()
            channel = dict(channels[index])
            channel['name'] = data.get('name', channel['name'])
            if data.get('rotate_key'):
                channel['key'] = base64.b64encode(secrets.token_bytes(32)).decode()
            elif data.get('key'):
                channel['key'] = data['key']
            channels[index] = validate_channel(channel)
            if any(other == channels[index] for i, other in enumerate(channels) if i != index):
                raise ValueError('This room is already on your profile.')
            return save(active, channels, index)
        except ValueError as error:
            return jsonify(error=str(error)), 400

    @app.route('/api/rooms/<int:index>/invite', methods=['POST'])
    @login_required
    def invite_to_room(index):
        try:
            active = profile()
            channels = selected(active, index)
            target = body().get('target_node_num')
            if type(target) is not int or not 0 < target < 0xFFFFFFFF:
                raise ValueError('Choose a valid recipient node.')
            if target == api['_profile_node_num'](active):
                raise ValueError('Choose another node to invite.')
            # Send on the existing selected transport, not the invited private room.
            # Firefly supplies public-key encrypted DM routing and delivery tracking.
            message = f"Join my room {channels[index]['name']}: {channel_url(channels[index])}"
            if len(message.encode('utf-8')) > 220:
                raise ValueError('Invitation exceeds the mesh message limit.')
            success = api['udp_server'].send_message(
                message, api['_effective_profile'](active), message_type='dm', target_node_num=target,
            )
            if not success:
                return jsonify(error=api['udp_server'].last_send_error or 'Invitation could not be sent.'), 502
            return jsonify(message='Invitation sent by DM.')
        except ValueError as error:
            return jsonify(error=str(error)), 400
