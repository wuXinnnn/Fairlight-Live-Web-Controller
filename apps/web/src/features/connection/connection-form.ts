import { emberEndpointSchema, type EmberEndpoint } from '@flwc/shared';

export interface EndpointFieldErrors {
  host?: string;
  port?: string;
}

export type EndpointValidation =
  { ok: true; value: EmberEndpoint } | { ok: false; errors: EndpointFieldErrors };

const HOST_ERROR = 'Enter a valid IP address or host name.';
const PORT_ERROR = 'Port must be a whole number between 1 and 65535.';

const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_PATTERN = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);
const IPV6_PATTERN = /^(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i;
const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * Accepts a dotted IPv4 address, a plain IPv6 address, or a DNS host name. Digit-only dotted
 * strings must be a complete IPv4 address so a mistyped `192.168.1` is not taken for a host name.
 */
export function isValidHost(host: string): boolean {
  if (IPV4_PATTERN.test(host)) {
    return true;
  }
  if (host.includes(':')) {
    return (
      IPV6_PATTERN.test(host) &&
      /[0-9a-f]/i.test(host) &&
      !host.includes(':::') &&
      host.replace(/[^:]/g, '').length <= 7
    );
  }
  if (host.length > 253 || !/[a-z]/i.test(host)) {
    return false;
  }
  return host.split('.').every((label) => HOSTNAME_LABEL.test(label));
}

/** Turns the PORT input into a number; anything but plain digits becomes NaN so zod rejects it. */
export function parsePortInput(text: string): number {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

/** Validates the panel inputs with the shared endpoint schema and maps issues to field messages. */
export function validateEndpoint(host: string, port: string): EndpointValidation {
  const parsed = emberEndpointSchema.safeParse({ host: host.trim(), port: parsePortInput(port) });
  if (parsed.success) {
    return isValidHost(parsed.data.host)
      ? { ok: true, value: parsed.data }
      : { ok: false, errors: { host: HOST_ERROR } };
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
