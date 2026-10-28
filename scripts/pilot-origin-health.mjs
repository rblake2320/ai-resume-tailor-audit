import { readFile } from 'node:fs/promises';
import { fetchPilotOrigin, closePilotOriginConnections } from './pilot-origin-fetch.mjs';
try {
  const owner = JSON.parse(await readFile('.resume-foundry/pilot/operator/owner-secrets.json', 'utf8'));
  const response = await fetchPilotOrigin(`${process.argv[2]}/api/capabilities`, {
    headers: { 'x-resume-pilot-origin': owner.ORIGIN_SECRET }, signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Origin rejected health check.');
  const capabilities = await response.json();
  if (capabilities.mode !== 'invite-only-tester-pilot' || capabilities.generationEnabled !== true) throw new Error('Origin mode mismatch.');
} catch { process.exitCode = 1; }
finally { await closePilotOriginConnections(); }
