import { emberEndpointSchema, type EmberEndpoint } from '@flwc/shared';

export interface EndpointFieldErrors {
  host?: string;
  port?: string;
}

export type EndpointValidation =
  { ok: true; value: EmberEndpoint } | { ok: false; errors: EndpointFieldErrors };

const HOST_ERROR = 'Enter a host name or IP address.';
const PORT_ERROR = 'Port must be a whole number between 1 and 65535.';

/** Turns the PORT input into a number; anything but plain digits becomes NaN so zod rejects it. */
export function parsePortInput(text: string): number {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** Validates the panel inputs with the shared endpoint schema and maps issues to field messages. */
export function validateEndpoint(host: string, port: string): EndpointValidation {
  const parsed = emberEndpointSchema.safeParse({ host: host.trim(), port: parsePortInput(port) });
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  const errors: EndpointFieldErrors = {};
  for (const issue of parsed.error.issues) {
    if (issue.path[0] === 'host') {
      errors.host = HOST_ERROR;
    } else if (issue.path[0] === 'port') {
      errors.port = PORT_ERROR;
    }
  }
  return { ok: false, errors };
}
