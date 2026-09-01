import { Model } from 'emberplus-connection';

export type EmberTreeNode = Model.NumberedTreeNode<Model.EmberElement>;
export type EmberParameterNode = Model.NumberedTreeNode<Model.Parameter>;
export type EmberFunctionNode = Model.NumberedTreeNode<Model.EmberFunction>;
export type EmberCollection = { readonly [index: number]: EmberTreeNode };

export type EmberValue = string | number | boolean;

export interface EmberDirectoryRequest {
  sentOk?: boolean;
  response?: Promise<unknown>;
}

export interface EmberClientHandle {
  tree: EmberCollection;
  readonly connected: boolean;
  connect(): Promise<Error | undefined>;
  disconnect(): Promise<void>;
  discard(): void;
  getDirectory(node: EmberTreeNode | EmberCollection): Promise<EmberDirectoryRequest>;
  subscribe(
    node: EmberTreeNode,
    cb?: (node: EmberTreeNode) => void,
  ): Promise<EmberDirectoryRequest>;
  unsubscribe(node: EmberTreeNode): Promise<EmberDirectoryRequest>;
  setValue(node: EmberParameterNode, value: EmberValue): Promise<EmberDirectoryRequest>;
  invoke(node: EmberFunctionNode): Promise<EmberDirectoryRequest>;
  on(event: 'disconnected' | 'error' | 'connected', listener: (error?: Error) => void): void;
  off(event: 'disconnected' | 'error' | 'connected', listener: (error?: Error) => void): void;
}

export type EmberClientFactory = (
  host: string,
  port: number,
  timeoutMs: number,
) => EmberClientHandle;
