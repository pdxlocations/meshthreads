"""Evidence for public-channel discovery, tied to an exact name and one-byte key."""
import base64
import hashlib
import json
from encryption import generate_hash


def public_channel_fingerprint(channel):
    name = str(channel.get('name', '')).strip()
    key = str(channel.get('key', '')).strip().replace('-', '+').replace('_', '/')
    try:
        raw = base64.b64decode(key, validate=True)
    except (ValueError, UnicodeError):
        return None
    if not name or len(name.encode('utf-8')) > 12 or len(raw) != 1:
        return None
    return hashlib.sha256(json.dumps([name, raw[0]], ensure_ascii=False).encode()).hexdigest()


def verified_public_channels(packet, profiles):
    """Validate actual group traffic; PKI DMs and our own nodes are not evidence."""
    from rooms import public_channels_from_profiles
    from mudp.encryption import decrypt_packet
    from meshtastic.protobuf import portnums_pb2
    sender = int(getattr(packet, 'from', 0))
    if not 0 < sender < 0xFFFFFFFF or packet.pki_encrypted:
        return []
    if any(str(profile.get('node_id', '')).lower() == f'!{sender:08x}' for profile in profiles.values()):
        return []
    verified = []
    for channel in public_channels_from_profiles(profiles):
        if generate_hash(channel['name'], channel['key']) != packet.channel:
            continue
        if packet.HasField('encrypted'):
            data = decrypt_packet(packet, channel['key'], silent=True)
        elif packet.HasField('decoded') and base64.b64decode(channel['key']) == b'\x00':
            # Cleartext does not prove possession of a nonzero PSK.
            data = packet.decoded
        else:
            continue
        if data is not None and data.portnum in portnums_pb2.PortNum.values() and data.portnum != 0 and data.payload:
            verified.append(channel)
    return verified
