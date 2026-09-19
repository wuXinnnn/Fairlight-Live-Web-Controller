import type { Server as NetServer, Socket } from 'node:net';
import { EmberServer, Model, Types, berEncode } from 'emberplus-connection';

type EmberValue = string | number | boolean | Buffer | null;
import type { DumpTree } from './dump-types.js';
import { dumpToEmberTree } from './dump-to-ember-tree.js';
import { assertNotLiveFairlightPort, findFreePort } from './find-free-port.js';
import { loadDumpTree } from './load-dump.js';

type EmberTreeNode = Model.NumberedTreeNode<Model.EmberElement>;
type EmberCollection = { [index: number]: EmberTreeNode };

/** The S101 listener behind `EmberServer`: its `net.Server` and the hand-off that starts a session. */
interface S101Listener {
  server: NetServer | null;
  addClient(socket: Socket): void;
}

export interface MockEmberProviderOptions {
  host?: string;
  port?: number;
  /**
   * Greater than zero: an accepted TCP connection waits its turn, and one is handed to the S101
   * session every this many milliseconds. Fairlight Live admits about one connection every 500 ms,
   * so a client that queued behind others sees a connected socket that stays silent, and its
   * first GetDirectory times out. The TCP handshake itself still completes at once; a full listen
   * backlog (dropped SYNs) cannot be reproduced portably and is not attempted.
   */
  acceptIntervalMs?: number;
  /**
   * Keep the provider's side of a session open after the client half-closes it. Fairlight Live
   * never answers a FIN, so a client that hangs up with `end()` leaves a CLOSE_WAIT session
   * behind for good; one that hangs up with a reset does not. `halfClosedCount` says how many
   * such sessions this provider is holding.
   */
  holdHalfClosed?: boolean;
}

export interface AddNodeOptions {
  notify?: boolean;
  announceChildren?: boolean;
}

export class MockEmberProvider {
  readonly host: string;
  private boundPort: number | undefined;
  private server: EmberServer | undefined;
  private readonly tree: EmberCollection;
  private readonly trackedSockets = new Set<Socket>();
  private readonly halfClosedSockets = new Set<Socket>();
  private readonly acceptQueue: Socket[] = [];
  private acceptTimer: ReturnType<typeof setTimeout> | undefined;
  private acceptedSessions = 0;

  constructor(
    tree: EmberCollection,
    private readonly options: MockEmberProviderOptions = {},
  ) {
    this.host = options.host ?? '127.0.0.1';
    this.tree = tree;
  }

  static fromDump(dump: DumpTree, options: MockEmberProviderOptions = {}): MockEmberProvider {
    return new MockEmberProvider(dumpToEmberTree(dump), options);
  }

  static fromDumpFile(
    filePath?: string,
    options: MockEmberProviderOptions = {},
  ): MockEmberProvider {
    return MockEmberProvider.fromDump(loadDumpTree(filePath), options);
  }

  get port(): number {
    if (this.boundPort === undefined) {
      throw new Error('Mock Ember+ Provider is not listening');
    }
    return this.boundPort;
  }

  /** Connections handed to an S101 session so far, queued ones not included. */
  get acceptedCount(): number {
    return this.acceptedSessions;
  }

  /** Sessions the client has half-closed and this provider is still holding open. */
  get halfClosedCount(): number {
    return this.halfClosedSockets.size;
  }

  async listen(): Promise<{ host: string; port: number }> {
    if (this.server !== undefined) {
      throw new Error('Mock Ember+ Provider is already listening');
    }
    const port = this.options.port ?? (await findFreePort(this.host));
    assertNotLiveFairlightPort(port);
    const server = new EmberServer(port, this.host);
    server.onSetValue = async (parameter, value) => {
      if (parameter.contents.access === Model.ParameterAccess.Read) {
        return false;
      }
      server.update(parameter, { value });
      return true;
    };
    server.onInvocation = async (emberFunction, invocation) => {
      if (emberFunction.contents.identifier === 'reset') {
        resetLoudness(server);
      }
      return {
        id: invocation.contents.invocation?.id ?? 0,
        success: true,
      };
    };
    await server.init(this.tree);
    this.interceptConnections(server);
    this.server = server;
    this.boundPort = port;
    return { host: this.host, port };
  }

  close(): void {
    if (this.acceptTimer !== undefined) {
      clearTimeout(this.acceptTimer);
      this.acceptTimer = undefined;
    }
    for (const socket of this.acceptQueue.splice(0)) {
      socket.destroy();
    }
    for (const socket of this.trackedSockets) {
      socket.destroy();
    }
    this.trackedSockets.clear();
    this.halfClosedSockets.clear();
    this.server?.discard();
    this.server = undefined;
    this.boundPort = undefined;
  }

  /**
   * Takes over the `connection` event of the listener's `net.Server` so that a socket can be
   * counted, held back, or kept half-open before the library starts an S101 session on it. The
   * library's own handler did nothing but `addClient(socket)`, which is what `admit` does.
   */
  private interceptConnections(server: EmberServer): void {
    const listener = (server as unknown as { _server: S101Listener })._server;
    // `init()` resolved, so the library has already called `listen()` and the server exists.
    const netServer = listener.server as NetServer;
    netServer.removeAllListeners('connection');
    netServer.on('connection', (socket: Socket) => {
      this.onConnection(socket, listener);
    });
  }

  private onConnection(socket: Socket, listener: S101Listener): void {
    this.trackedSockets.add(socket);
    // A queued socket has no other listener yet; without this one a reset would throw.
    socket.on('error', () => {
      this.halfClosedSockets.delete(socket);
    });
    socket.once('close', () => {
      this.trackedSockets.delete(socket);
      this.halfClosedSockets.delete(socket);
    });
    if (this.options.holdHalfClosed === true) {
      // Node would otherwise answer the client's FIN with its own; Fairlight never does.
      socket.allowHalfOpen = true;
      socket.on('end', () => {
        this.halfClosedSockets.add(socket);
      });
    }
    const intervalMs = this.options.acceptIntervalMs ?? 0;
    if (intervalMs <= 0) {
      this.admit(socket, listener);
      return;
    }
    this.acceptQueue.push(socket);
    if (this.acceptTimer === undefined) {
      this.admitNextQueued(listener, intervalMs);
    }
  }

  /** Lets one queued socket through and closes the gate again for `intervalMs`. */
  private admitNextQueued(listener: S101Listener, intervalMs: number): void {
    const socket = this.acceptQueue.shift();
    if (socket === undefined) {
      this.acceptTimer = undefined;
      return;
    }
    this.admit(socket, listener);
    this.acceptTimer = setTimeout(() => {
      this.admitNextQueued(listener, intervalMs);
    }, intervalMs);
  }

  private admit(socket: Socket, listener: S101Listener): void {
    if (socket.destroyed) {
      return;
    }
    this.acceptedSessions += 1;
    // No `data` listener goes on before this: the S101 codec must see every byte.
    listener.addClient(socket);
  }

  pushParameter(identifierPath: string, value: EmberValue): boolean {
    const node = this.getParameter(identifierPath);
    if (node === undefined || this.server === undefined) {
      return false;
    }
    this.server.update(node, { value });
    return true;
  }

  getParameter(identifierPath: string): Model.NumberedTreeNode<Model.Parameter> | undefined {
    const node = this.getNode(identifierPath);
    if (node === undefined || node.contents.type !== Model.ElementType.Parameter) {
      return undefined;
    }
    return node as Model.NumberedTreeNode<Model.Parameter>;
  }

  getNode(identifierPath: string): EmberTreeNode | undefined {
    if (this.server === undefined) {
      return undefined;
    }
    return (
      this.server.getElementByPath(identifierPath, '/') ??
      this.server.getElementByPath(identifierPath.replaceAll('/', '.'))
    );
  }

  addNode(
    parentIdentifierPath: string,
    node: EmberTreeNode,
    options: AddNodeOptions = {},
  ): boolean {
    const parent = this.getNode(parentIdentifierPath);
    if (parent === undefined || this.server === undefined) {
      return false;
    }
    if (parent.children === undefined) {
      parent.children = {};
    }
    parent.children[node.number] = node;
    node.parent = parent;
    if (options.notify !== false) {
      this.notifyInserted(node, options.announceChildren !== false);
    }
    return true;
  }

  setNodeOnline(identifierPath: string, online: boolean): boolean {
    const node = this.getNode(identifierPath);
    if (node === undefined || this.server === undefined) {
      return false;
    }
    this.server.update(node, { isOnline: online });
    return true;
  }

  private notifyInserted(node: EmberTreeNode, announceChildren = true): void {
    if (this.server === undefined) {
      return;
    }
    const qualified = new Model.QualifiedElementImpl(
      emberNumberPath(node),
      node.contents,
      announceChildren ? node.children : undefined,
    );
    const data = berEncode(
      [qualified] as unknown as Parameters<typeof berEncode>[0],
      Types.RootType.Elements,
    );
    const clients = (
      this.server as unknown as { _clients: Set<{ sendBER: (data: Buffer) => void }> }
    )._clients;
    for (const client of clients) {
      client.sendBER(data);
    }
  }
}

function emberNumberPath(node: EmberTreeNode): string {
  const numbers: number[] = [];
  let current: EmberTreeNode | undefined = node;
  while (current !== undefined) {
    numbers.unshift(current.number);
    current = current.parent as EmberTreeNode | undefined;
  }
  return numbers.join('.');
}

function resetLoudness(server: EmberServer): void {
  for (const path of ['system/loudness/integrated', 'system/loudness/true-peak']) {
    const node = server.getElementByPath(path, '/');
    if (node !== undefined && node.contents.type === Model.ElementType.Parameter) {
      server.update(node, { value: -60 });
    }
  }
}
