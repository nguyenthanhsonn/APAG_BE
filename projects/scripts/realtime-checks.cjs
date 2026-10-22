const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { io } = require('socket.io-client');
const { JwtService } = require('@nestjs/jwt');

module.exports = async function realtimeChecks({
  a,
  b,
  token,
  adminToken,
  revokedToken,
  studentId,
  adminId,
  secret,
  emit,
}) {
  const sockets = [];
  const checks = [];
  const jwt = new JwtService({ secret });
  const claims = jwt.decode(token);
  function event(socket, name, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const handler = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        socket.off(name, handler);
        reject(Error(`Socket event timeout: ${name}`));
      }, timeout);
      socket.once(name, handler);
    });
  }
  function socket(base, auth = {}, transports = ['websocket']) {
    const client = io(base.replace('/api/v1', '') + '/notifications', {
      auth,
      transports,
      autoConnect: false,
      reconnection: false,
      timeout: 5000,
      forceNew: true,
    });
    sockets.push(client);
    return client;
  }
  async function rejected(auth, name) {
    const client = socket(b, auth);
    const result = event(client, 'connect_error');
    client.connect();
    const error = await result;
    assert.equal(error.message, 'Unauthorized');
    assert.equal(error.data.status, 401);
    assert.equal(client.connected, false);
    client.disconnect();
    checks.push(name);
  }
  async function connected(base, token, transports) {
    const client = socket(base, { token }, transports);
    const ready = event(client, 'notifications:connected');
    client.connect();
    const identity = await ready;
    return { client, identity };
  }
  try {
    await rejected(
      { userId: studentId },
      'ws_rejects_client_identity_without_jwt',
    );
    await rejected({ token: 'invalid' }, 'ws_rejects_malformed_jwt');
    await rejected(
      {
        token: new JwtService({ secret: 'different-test-signing-secret' }).sign(
          claims,
        ),
      },
      'ws_rejects_invalid_signature',
    );
    const { iat, exp, ...subject } = claims;
    await rejected(
      { token: jwt.sign(subject, { expiresIn: -1 }) },
      'ws_rejects_expired_access_token',
    );
    await rejected(
      { token: revokedToken },
      'ws_rejects_revoked_access_token_across_nodes',
    );
    await rejected(
      { token: jwt.sign({ ...subject, sub: randomUUID() }, { expiresIn: 60 }) },
      'ws_rejects_missing_db_principal',
    );
    const studentA = await connected(a, token);
    const studentB = await connected(b, token, ['polling']);
    const adminB = await connected(b, adminToken);
    assert.equal(studentA.identity.userId, studentId);
    assert.equal(studentB.identity.userId, studentId);
    assert.equal(adminB.identity.userId, adminId);
    checks.push('ws_handshake_derives_user_from_jwt_websocket_and_polling');
    let leaks = 0;
    adminB.client.on('notifications:new', () => leaks++);
    const forbidden = event(adminB.client, 'notifications:error');
    adminB.client.emit('notifications:join', { userId: studentId });
    assert.equal((await forbidden).status, 403);
    checks.push('ws_rejects_arbitrary_user_room');
    const receivedA = event(studentA.client, 'notifications:new');
    const receivedB = event(studentB.client, 'notifications:new');
    const notification = {
      id: randomUUID(),
      userId: studentId,
      type: 'test',
      title: 'Synthetic realtime check',
      content: 'No production data',
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    await emit(a, notification);
    assert.deepEqual(await receivedA, notification);
    assert.deepEqual(await receivedB, notification);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(leaks, 0);
    checks.push('notification_a_reaches_a_and_b_without_other_user_leak');
    const refreshed = event(studentA.client, 'notifications:refresh');
    await emit(b, { userId: studentId }, 'refresh');
    await refreshed;
    checks.push('refresh_b_reaches_socket_a');
    const short = await connected(b, jwt.sign(subject, { expiresIn: 2 }));
    await event(short.client, 'disconnect', 4000);
    assert.equal(short.client.connected, false);
    checks.push('ws_disconnects_on_token_expiry');
    // Exercise the real shared user-revocation path while existing sockets are idle.
    const disconnectedA = event(studentA.client, 'disconnect', 18000);
    const disconnectedB = event(studentB.client, 'disconnect', 18000);
    await emit(a, { userId: studentId }, 'revoke');
    await Promise.all([disconnectedA, disconnectedB]);
    checks.push('ws_idle_connections_recheck_shared_revocation');
    return checks;
  } finally {
    for (const client of sockets) client.disconnect();
  }
};
