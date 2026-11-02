import { ProxyAgent } from 'undici';
import { config } from '../config.js';

/** Maximum time a single Apple/iCloud HTTP exchange may occupy a worker. */
export const ICLOUD_REQUEST_TIMEOUT_MS = 30_000;

function proxyUrlFor(url: string): string | undefined {
  const target = new URL(url);
  const noProxy = config.network.noProxy
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (
    noProxy.some((pattern) => {
      if (!pattern) return false;
      if (pattern === '*') return true;
      if (pattern.startsWith('.')) return target.hostname.endsWith(pattern);
      if (pattern.startsWith('*.')) return target.hostname.endsWith(pattern.slice(1));
      return target.hostname === pattern || target.host === pattern;
    })
  ) {
    return undefined;
  }

  const proxy = target.protocol === 'https:' ? config.network.httpsProxy : config.network.httpProxy;
  return proxy || undefined;
}

export class UpstreamTimeoutError extends Error {
  readonly status = 504;

  constructor(cause?: unknown) {
    super('连接 Apple/iCloud 服务超时，请检查网络后重试', { cause });
    this.name = 'UpstreamTimeoutError';
  }
}

/** Native fetch with a bounded lifetime and a stable user-facing timeout error. */
export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = config.network.timeoutMs || ICLOUD_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const proxy = proxyUrlFor(url);
  const fetchInit = { ...init, signal };

  try {
    if (!proxy) {
      return await fetch(input, fetchInit);
    }

    const dispatcher = new ProxyAgent({ uri: proxy }) as any;
    return await fetch(input, { ...fetchInit, dispatcher: dispatcher as any });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (signal.aborted || name === 'AbortError' || name === 'TimeoutError') {
      throw new UpstreamTimeoutError(err);
    }
    throw err;
  }
}
