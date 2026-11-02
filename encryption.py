"""Meshtastic channel-key normalization and channel hashing."""
import base64


MESHTASTIC_ONE_BYTE_PSK_PREFIX = bytes.fromhex("d4f1bb3a20290759f0bcffabcf4e69")


def expand_short_psk(key: str) -> str:
    try:
        raw_key = base64.b64decode(key.encode("ascii"), validate=True)
    except Exception:
        return key

    if len(raw_key) != 1 or not 0x01 <= raw_key[0] <= 0x07:
        return key

    return base64.b64encode(MESHTASTIC_ONE_BYTE_PSK_PREFIX + raw_key).decode("ascii")


def xor_hash(data: bytes) -> int:
    """Compute an XOR hash from bytes."""
    result = 0
    for char in data:
        result ^= char
    return result


def generate_hash(name: str, key: str) -> int:
    """generate the channel number by hashing the channel name and psk"""
    key = expand_short_psk(key)
    replaced_key = key.replace("-", "+").replace("_", "/")
    key_bytes = base64.b64decode(replaced_key.encode("utf-8"))
    h_name = xor_hash(bytes(name, "utf-8"))
    h_key = xor_hash(key_bytes)
    result: int = h_name ^ h_key
    return result
