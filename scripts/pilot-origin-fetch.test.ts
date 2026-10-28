import { afterEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ lookup: vi.fn(), resolve4: vi.fn(), connect: null as null | { lookup: (host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => void } }));
vi.mock('node:dns', () => ({ default: { lookup: fake.lookup } }));
vi.mock('node:dns/promises', () => ({ Resolver: class { setServers() {} resolve4 = fake.resolve4; } }));
vi.mock('undici', () => ({ Agent: class { constructor(options: { connect: typeof fake.connect }) { fake.connect = options.connect; } async close() {} } }));
import { fetchPilotOrigin } from './pilot-origin-fetch.mjs';

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('dedicated pilot recovery transport', () => {
  it('rejects foreign hosts, credentials, suffix tricks, ports and insecure tunnels before network', () => {
    const request = vi.fn(); vi.stubGlobal('fetch', request);
    for (const url of ['https://attacker.example/', 'https://a.trycloudflare.com.attacker.example/', 'http://a.trycloudflare.com/', 'https://a.trycloudflare.com:8443/', 'https://secret@a.trycloudflare.com/', 'http://127.0.0.1:11434/']) {
      expect(() => fetchPilotOrigin(url)).toThrow('Invalid dedicated pilot origin');
    }
    expect(request).not.toHaveBeenCalled();
  });
  it('forces redirect denial even if the caller asks to follow redirects', () => {
    const request = vi.fn().mockResolvedValue({ ok: true }); vi.stubGlobal('fetch', request);
    fetchPilotOrigin('https://test.trycloudflare.com/api/capabilities', { redirect: 'follow' });
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });
  it('retains successful system DNS without consulting alternate resolvers', async () => {
    fake.lookup.mockImplementation((_host, _options, cb) => cb(null, [{ address: '192.0.2.1', family: 4 }]));
    const result = await new Promise((resolve) => fake.connect!.lookup('test.trycloudflare.com', { all: true }, (...args) => resolve(args)));
    expect(result).toEqual([null, [{ address: '192.0.2.1', family: 4 }], undefined]);
    expect(fake.resolve4).not.toHaveBeenCalled();
  });
  it('recovers a tunnel ENOTFOUND with address objects for Node auto-family selection', async () => {
    fake.lookup.mockImplementation((_host, _options, cb) => cb({ code: 'ENOTFOUND' }));
    fake.resolve4.mockResolvedValue(['192.0.2.2']);
    const result = await new Promise((resolve) => fake.connect!.lookup('test.trycloudflare.com', { all: true }, (...args) => resolve(args)));
    expect(result).toEqual([null, [{ address: '192.0.2.2', family: 4 }]]);
  });
  it('never uses alternate DNS for another host or an unrelated error', async () => {
    fake.lookup.mockImplementation((_host, _options, cb) => cb({ code: 'ENOTFOUND' }));
    await new Promise((resolve) => fake.connect!.lookup('attacker.example', {}, resolve));
    fake.lookup.mockImplementation((_host, _options, cb) => cb({ code: 'EACCES' }));
    await new Promise((resolve) => fake.connect!.lookup('test.trycloudflare.com', {}, resolve));
    expect(fake.resolve4).not.toHaveBeenCalled();
  });
  it('preserves resolver failure rather than returning an empty address', async () => {
    fake.lookup.mockImplementation((_host, _options, cb) => cb({ code: 'ENOTFOUND' }));
    fake.resolve4.mockRejectedValue(new Error('DNS unavailable'));
    const result = await new Promise((resolve) => fake.connect!.lookup('test.trycloudflare.com', {}, resolve));
    expect(result).toBeInstanceOf(Error);
  });
});
