"""Meshtastic reactions use Data.emoji and Data.reply_id."""
import emoji


def is_emoji_reply(content, reply_packet_id, flagged=False):
    return bool(reply_packet_id and (flagged or emoji.is_emoji(str(content or '').strip())))
