import { EmberServer, Model, Types, berEncode } from 'emberplus-connection';

type EmberValue = string | number | boolean | Buffer | null;
import type { DumpTree } from './dump-types.js';
import { dumpToEmberTree } from './dump-to-ember-tree.js';
import { assertNotLiveFairlightPort, findFreePort } from './find-free-port.js';
import { loadDumpTree } from './load-dump.js';

type EmberTreeNode = Model.NumberedTreeNode<Model.EmberElement>;
type EmberCollection = { [index: number]: EmberTreeNode };

export interface MockEmberProviderOptions {
  host?: string;
  port?: number;
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
    this.server = server;
    this.boundPort = port;
    return { host: this.host, port };
  }

  close(): void {
    this.server?.discard();
    this.server = undefined;
    this.boundPort = undefined;
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
