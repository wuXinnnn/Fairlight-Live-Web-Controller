import { createServer } from 'node:net';

const LIVE_FAIRLIGHT_PORT = 9000;

export async function findFreePort(host = '127.0.0.1'): Promise<number> {
  const port = await listenEphemeral(host);
  if (port !== LIVE_FAIRLIGHT_PORT) {
    return port;
  }
  return listenEphemeral(host);
}

export function assertNotLiveFairlightPort(port: number): void {
  if (port === LIVE_FAIRLIGHT_PORT) {
    throw new Error(
      'Refusing to bind Mock Ember+ Provider on port 9000 (reserved for the live Fairlight)',
    );
  }
}

function listenEphemeral(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to allocate a TCP port'));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}
