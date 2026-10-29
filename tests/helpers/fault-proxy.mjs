import net from 'node:net';

/** Hold ONLY the COMMIT response, after letting the transaction's statements finish. */
export async function faultProxy(databaseUrl) {
  const database = new URL(databaseUrl);
  const sockets = new Set();
  let predicate;
  let dropped = 0;
  const server = net.createServer(client => {
    const upstream = net.connect({ host: database.hostname, port: Number(database.port) });
    sockets.add(client); sockets.add(upstream);
    let watchCommit = false, hold = false, held = Buffer.alloc(0);
    client.on('error', () => {});
    upstream.on('error', () => client.destroy());
    client.on('close', () => { sockets.delete(client); upstream.destroy(); });
    upstream.on('close', () => { sockets.delete(upstream); client.destroy(); });
    client.on('data', bytes => {
      const text = bytes.toString('latin1');
      if (predicate?.(text)) watchCommit = true;
      if (watchCommit && /COMMIT/i.test(text)) hold = true;
      upstream.write(bytes);
    });
    upstream.on('data', bytes => {
      if (!hold) { client.write(bytes); return; }
      held = Buffer.concat([held, bytes]);
      while (held.length >= 5) {
        const size = held.readUInt32BE(1) + 1;
        if (held.length < size) break;
        if (held[0] === 90 && held[5] === 73) { // ReadyForQuery / idle: COMMIT finished
          dropped++;
          predicate = undefined;
          client.destroy(); upstream.destroy();
          return;
        }
        held = held.subarray(size);
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = new URL(databaseUrl); url.port = String(server.address().port);
  return {
    url: url.href,
    arm: test => { predicate = test; },
    get dropped() { return dropped; },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
