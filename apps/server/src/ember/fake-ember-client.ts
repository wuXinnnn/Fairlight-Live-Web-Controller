import { EventEmitter } from 'node:events';
import type {
  EmberClientHandle,
  EmberCollection,
  EmberDirectoryRequest,
  EmberParameterNode,
  EmberTreeNode,
  EmberValue,
} from './types.js';
import { requiredTree } from './tree-helpers.js';

interface DirectoryListener {
  node: EmberTreeNode | EmberCollection;
  cb: (node: EmberTreeNode) => void;
}

/** Stands in for the `net.Socket` an S101 transport holds; it records how it was closed. */
export class FakeEmberSocket {
  destroyed = false;
  destroyCalls = 0;
  resetCalls = 0;
  endCalls = 0;
  private errorListeners: Array<(error: Error) => void> = [];

  on(event: 'error', listener: (error: Error) => void): this {
    if (event === 'error') {
      this.errorListeners.push(listener);
    }
    return this;
  }

  once(event: 'error', listener: (error: Error) => void): this {
    const wrapped = (error: Error): void => {
      this.errorListeners = this.errorListeners.filter((entry) => entry !== wrapped);
      listener(error);
    };
    return this.on(event, wrapped);
  }

  emitError(error: Error): void {
    for (const listener of [...this.errorListeners]) {
      listener(error);
    }
  }

  removeAllListeners(): this {
    this.errorListeners = [];
    return this;
  }

  destroy(): void {
    this.destroyCalls += 1;
    this.destroyed = true;
  }

  resetAndDestroy(): void {
    this.resetCalls += 1;
    this.destroyed = true;
  }

  /** What the library's `disconnect()` does to the socket: a FIN. */
  end(): void {
    this.endCalls += 1;
  }
}

/** Stands in for the library's S101Client, reachable through `_client` like the real one. */
export class FakeEmberTransport {
  socket: FakeEmberSocket | undefined = new FakeEmberSocket();
  _autoReconnect = true;
  _shouldBeConnected = false;
  connect = async (): Promise<undefined> => undefined;
}

export class FakeEmberClient extends EventEmitter implements EmberClientHandle {
  tree: EmberCollection;
  connected = false;
  discarded = false;
  disconnectCalls = 0;
  /** Set to give the client a transport, so `captureEmberTransport` finds something to retire. */
  transport: FakeEmberTransport | undefined;
  /** Emitted on the transport's socket while connecting, before `failConnect` or `hangConnect`. */
  socketError: Error | undefined;
  connectDelayMs = 0;
  hangConnect = false;
  hangDisconnect = false;
  hangGetDirectory = false;
  getDirectoryDelayMs = 0;
  failConnect: Error | undefined;
  failSubscribe: Error | undefined;
  readonly failSubscribeNodes = new Set<EmberTreeNode>();
  expandCalls = 0;
  setValueCalls: EmberValue[] = [];
  setValueDelayMs = 0;
  concurrentSetValue = 0;
  maxConcurrentSetValue = 0;
  invokeCalls = 0;
  hangInvokeResponse = false;
  failInvokeSend = false;
  subscribeCalls = 0;
  readonly directoryListeners: DirectoryListener[] = [];
  readonly host: string | undefined;
  readonly port: number | undefined;

  constructor(tree: EmberCollection = requiredTree(), host?: string, port?: number) {
    super();
    this.tree = tree;
    this.host = host;
    this.port = port;
  }

  /** The real client exposes its S101Client here; `captureEmberTransport` reads it. */
  get _client(): FakeEmberTransport | undefined {
    return this.transport;
  }

  async connect(): Promise<Error | undefined> {
    if (this.socketError !== undefined) {
      const error = this.socketError;
      // The library's socket error fires asynchronously, after the dial has been started.
      queueMicrotask(() => this.transport?.socket?.emitError(error));
    }
    if (this.hangConnect) {
      return new Promise(() => undefined);
    }
    if (this.connectDelayMs > 0) {
      await delay(this.connectDelayMs);
    }
    if (this.failConnect !== undefined) {
      throw this.failConnect;
    }
    this.connected = true;
    this.emit('connected');
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    this.transport?.socket?.end();
    if (this.hangDisconnect) {
      return new Promise(() => undefined);
    }
    this.connected = false;
    this.emit('disconnected');
  }

  discard(): void {
    this.discarded = true;
    this.connected = false;
    // Like the library: discard() hangs up first, which reaches the socket only if one is left.
    this.transport?.socket?.end();
    this.transport = undefined;
  }

  /** The library patches `_updateTree`; a fake one lets a test drive `onChildrenAdded`. */
  _updateTree(update: EmberTreeNode, tree: EmberTreeNode | undefined): unknown[] {
    // The patch in front of this does the merging; the original only has to exist and return.
    void update;
    void tree;
    return [];
  }

  async getDirectory(
    node?: EmberTreeNode | EmberCollection,
    onUpdate?: (node: EmberTreeNode) => void,
  ): Promise<EmberDirectoryRequest> {
    if (this.hangGetDirectory) {
      return new Promise(() => undefined);
    }
    if (this.getDirectoryDelayMs > 0) {
      await delay(this.getDirectoryDelayMs);
    }
    this.expandCalls += 1;
    if (node !== undefined && onUpdate !== undefined) {
      this.directoryListeners.push({ node, cb: onUpdate });
    }
    return {};
  }

  async subscribe(
    node?: EmberTreeNode,
    cb?: (node: EmberTreeNode) => void,
  ): Promise<EmberDirectoryRequest> {
    this.subscribeCalls += 1;
    if (this.failSubscribe !== undefined) {
      throw this.failSubscribe;
    }
    if (node !== undefined && this.failSubscribeNodes.has(node)) {
      throw new Error('subscribe denied');
    }
    if (node !== undefined && cb !== undefined) {
      this.directoryListeners.push({ node, cb });
    }
    return {};
  }

  emitNodeUpdate(node: EmberTreeNode): void {
    for (const listener of this.directoryListeners) {
      if (listener.node === node) {
        listener.cb(node);
      }
    }
  }

  async unsubscribe(): Promise<EmberDirectoryRequest> {
    return {};
  }

  async setValue(_node: EmberParameterNode, value: EmberValue): Promise<EmberDirectoryRequest> {
    this.concurrentSetValue += 1;
    this.maxConcurrentSetValue = Math.max(this.maxConcurrentSetValue, this.concurrentSetValue);
    if (this.setValueDelayMs > 0) {
      await delay(this.setValueDelayMs);
    }
    this.concurrentSetValue -= 1;
    this.setValueCalls.push(value);
    return {};
  }

  async invoke(): Promise<EmberDirectoryRequest> {
    this.invokeCalls += 1;
    if (this.failInvokeSend) {
      return { sentOk: false };
    }
    if (this.hangInvokeResponse) {
      return { sentOk: true, response: new Promise(() => undefined) };
    }
    return { sentOk: true, response: Promise.resolve({ success: true }) };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
