import dns from 'node:dns';
import { Resolver } from 'node:dns/promises';
import { Agent } from 'undici';

// Scoped to the dedicated Quick Tunnel; never change host-wide DNS settings.
const resolver = new Resolver({ timeout: 2000, tries: 1 });
resolver.setServers(['1.1.1.1', '1.0.0.1']);
const dispatcher = new Agent({ connect: { lookup(hostname, options, callback) {
  dns.lookup(hostname, options, (error, address, family) => {
    if (!error || !['ENOTFOUND', 'EAI_AGAIN'].includes(error.code)) return callback(error, address, family);
    if (!/^[a-z0-9-]+\.trycloudflare\.com$/.test(hostname)) return callback(error);
    resolver.resolve4(hostname).then((addresses) => {
      if (!addresses.length) return callback(error);
      if (options.all) callback(null, addresses.map((ip) => ({ address: ip, family: 4 })));
      else callback(null, addresses[0], 4);
    }, callback);
  });
} } });

export function fetchPilotOrigin(url, options = {}) {
  const target = new URL(url);
  const local = target.origin === 'http://127.0.0.1:3102';
  const tunnel = target.protocol === 'https:' && !target.port && /^[a-z0-9-]+\.trycloudflare\.com$/.test(target.hostname);
  if ((!local && !tunnel) || target.username || target.password) throw new Error('Invalid dedicated pilot origin.');
  return fetch(target, { ...options, dispatcher, redirect: 'error' });
}

export async function closePilotOriginConnections() { await dispatcher.close(); }
