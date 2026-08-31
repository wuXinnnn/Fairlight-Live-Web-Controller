import { EmberServer, Model } from 'emberplus-connection';

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
    if (this.server === undefined) {
      return undefined;
    }
    const node =
      this.server.getElementByPath(identifierPath, '/') ??
      this.server.getElementByPath(identifierPath.replaceAll('/', '.'));
    if (node === undefined || node.contents.type !== Model.ElementType.Parameter) {
      return undefined;
    }
    return node as Model.NumberedTreeNode<Model.Parameter>;
  }
}

function resetLoudness(server: EmberServer): void {
  for (const path of ['system/loudness/integrated', 'system/loudness/true-peak']) {
    const node = server.getElementByPath(path, '/');
    if (node !== undefined && node.contents.type === Model.ElementType.Parameter) {
      server.update(node, { value: -60 });
    }
  }
}
