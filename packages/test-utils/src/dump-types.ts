export type DumpJsonValue = string | number | boolean | null | { readonly $buffer: string };

export type DumpElementType = 'NODE' | 'PARAMETER' | 'FUNCTION' | 'MATRIX' | 'TEMPLATE' | 'COMMAND';

export interface DumpNode {
  number: number;
  numberPath: string;
  identifierPath: string;
  identifier?: string;
  description?: string;
  elementType: DumpElementType;
  parameterType?: string;
  value?: DumpJsonValue;
  minimum?: number | null;
  maximum?: number | null;
  format?: string;
  access?: string;
  streamIdentifier?: number;
  factor?: number;
  enumeration?: string;
  isOnline?: boolean;
  isRoot?: boolean;
  children?: DumpNode[];
  error?: string;
}

export interface DumpError {
  path: string;
  message: string;
}

export interface DumpTree {
  dumpedAt: string;
  host: string;
  port: number;
  nodes: DumpNode[];
  errors: DumpError[];
}
