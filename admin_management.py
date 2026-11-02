"""Scoped admin mutations; channel changes affect one profile, not shared history."""
from flask import jsonify, request
from werkzeug.security import generate_password_hash


def register_admin_management_routes(api):
    app = api['app']
    admin_required = api['admin_required']

    def result_response(result):
        errors = {
            'forbidden': ('Admin access required.', 403),
            'missing': ('User, profile, or channel not found.', 404),
            'duplicate': ('That username or channel already exists.', 409),
            'last_admin': ('Keep at least one admin.', 409),
            'self_delete': ('Use Account settings to delete your own account.', 409),
            'last_channel': ('Keep at least one room on this profile.', 409),
            'stale': ('The channels have changed. Refresh and try again.', 409),
        }
        if result in errors:
            message, status = errors[result]
            return jsonify(error=message), status
        return jsonify(ok=True)

    def active_profile_id():
        transport = api['udp_server']
        active = transport.get_active_profile() if transport.running else None
        return active.get('id') if active else None

    @app.route('/api/admin/users/<user_id>', methods=['PUT', 'DELETE'])
    @admin_required
    def admin_manage_user(user_id):
        actor = api['_get_session_user']()['id']
        db = api['db']
        if request.method == 'DELETE':
            active = active_profile_id()
            if active and active in db.get_all_profiles(user_id=user_id):
                return jsonify(error='Deactivate this user’s radio profile before deleting the account.'), 409
            result = db.admin_delete_user(actor, user_id)
            if result == 'ok':
                for sid, owner in list(api['websocket_users'].items()):
                    if owner == user_id:
                        api['socketio'].server.disconnect(sid, namespace='/')
            return result_response(result)
        data = request.get_json(silent=True)
        if not isinstance(data, dict):
            return jsonify(error='User must be a JSON object.'), 400
        username = data.get('username')
        password = data.get('password', '')
        if not isinstance(username, str) or not 1 <= len(username.strip()) <= 80:
            return jsonify(error='Username must contain 1–80 characters.'), 400
        if not isinstance(password, str) or len(password) > 1024:
            return jsonify(error='Password must be text up to 1024 characters.'), 400
        return result_response(db.admin_edit_user(actor, user_id, username.strip(),
                               generate_password_hash(password) if password else None))

    @app.route('/api/admin/profiles/<profile_id>/channels/<int:index>', methods=['PUT', 'DELETE'])
    @admin_required
    def admin_manage_channel(profile_id, index):
        if active_profile_id() == profile_id:
            return jsonify(error='Deactivate this radio profile before changing its rooms.'), 409
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or not isinstance(data.get('revision'), str):
            return jsonify(error='A channel revision is required. Refresh and try again.'), 400
        channel = None
        if request.method == 'PUT':
            if not isinstance(data.get('name'), str) or not data['name'].strip():
                return jsonify(error='Enter a room name.'), 400
            if not isinstance(data.get('key', ''), str):
                return jsonify(error='PSK must be base64 text.'), 400
            channel = {'name': data['name'], 'key': data.get('key', '')}
        try:
            result = api['db'].admin_change_channel(api['_get_session_user']()['id'], profile_id,
                                                   index, data['revision'], channel)
        except ValueError as error:
            return jsonify(error=str(error)), 400
        if result != 'ok':
            return result_response(result)
        updated = api['db'].get_profile(profile_id)
        try:
            api['ensure_profile_config'](updated, api['MCAST_GRP'], api['MCAST_PORT'])
        except Exception:
            # The database is authoritative; activation also regenerates runtime
            # configuration. Do not report a failed save after committing it.
            return jsonify(ok=True, warning='Room saved. Runtime configuration could not be refreshed; check it before reactivating this profile.')
        return result_response(result)
