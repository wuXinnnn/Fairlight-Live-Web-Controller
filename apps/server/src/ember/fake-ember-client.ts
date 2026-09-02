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

export class FakeEmberClient extends EventEmitter implements EmberClientHandle {
  tree: EmberCollection;
  connected = false;
  discarded = false;
  connectDelayMs = 0;
  hangConnect = false;
  hangDisconnect = false;
  failConnect: Error | undefined;
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

  async connect(): Promise<Error | undefined> {
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
    if (this.hangDisconnect) {
      return new Promise(() => undefined);
    }
    this.connected = false;
    this.emit('disconnected');
  }

  discard(): void {
    this.discarded = true;
    this.connected = false;
  }

  async getDirectory(
    node?: EmberTreeNode | EmberCollection,
    onUpdate?: (node: EmberTreeNode) => void,
  ): Promise<EmberDirectoryRequest> {
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
