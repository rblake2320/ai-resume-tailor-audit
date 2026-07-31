"use client";

import { useEffect, useState } from "react";
import {
  BlsObservationSeriesSchema,
  createCareerPathRecord,
  OnetOccupationProfileSchema,
  parseCurrentProjectionSnapshot,
  TrainingResourceSchema,
  type BlsObservationSeries,
  type OnetOccupationProfile,
} from "@/lib/labor-market";
import { deleteCareerPathRecord, loadCareerPathRecords, saveCareerPathRecord } from "@/lib/labor-market-storage";
import { ToolButton } from "@/components/ui";

const parseLines = (value: string) => value.split(/[,\n]/u).map((item) => item.trim()).filter(Boolean);

export function CareerPathPlanner() {
  const [occupationCode, setOccupationCode] = useState("");
  const [profile, setProfile] = useState<OnetOccupationProfile | null>(null);
  const [projectionJson, setProjectionJson] = useState("");
  const [evidenceGaps, setEvidenceGaps] = useState("");
  const [trainingJson, setTrainingJson] = useState("[]");
  const [blsSeriesIds, setBlsSeriesIds] = useState("");
  const [blsStartYear, setBlsStartYear] = useState(String(new Date().getUTCFullYear() - 1));
  const [blsEndYear, setBlsEndYear] = useState(String(new Date().getUTCFullYear()));
  const [observations, setObservations] = useState<BlsObservationSeries[]>([]);
  const [records, setRecords] = useState(() => loadCareerPathRecords());
  const [status, setStatus] = useState("Look up an O*NET occupation, then import an authoritative projection snapshot.");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const cleared = () => { setRecords([]); setProfile(null); setObservations([]); setStatus("Career-path records erased from this browser."); };
    window.addEventListener("resume-foundry:data-cleared", cleared);
    return () => window.removeEventListener("resume-foundry:data-cleared", cleared);
  }, []);

  async function lookupOnet() {
    setWorking(true); setStatus("Checking O*NET…");
    try {
      const response = await fetch("/api/labor-market/onet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ occupationCode: occupationCode.trim() }) });
      const body = await response.json() as { profile?: unknown; error?: string };
      if (!response.ok) throw new Error(body.error ?? "O*NET lookup failed.");
      const next = OnetOccupationProfileSchema.parse(body.profile);
      setProfile(next); setStatus(`Loaded ${next.occupationTitle} with source provenance. No projection was inferred.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "O*NET lookup failed."); }
    finally { setWorking(false); }
  }

  async function lookupBlsSeries() {
    setWorking(true); setStatus("Checking BLS time series…");
    try {
      const response = await fetch("/api/labor-market/bls-series", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ seriesIds: parseLines(blsSeriesIds), startYear: Number(blsStartYear), endYear: Number(blsEndYear) }),
      });
      const body = await response.json() as { series?: unknown; error?: string };
      if (!response.ok) throw new Error(body.error ?? "BLS lookup failed.");
      const next = BlsObservationSeriesSchema.array().parse(body.series);
      setObservations(next); setStatus("BLS observations loaded. They are not used as occupational projections.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "BLS lookup failed."); }
    finally { setWorking(false); }
  }

  function savePath() {
    try {
      if (!profile) throw new Error("Load an O*NET occupation profile first.");
      const projection = parseCurrentProjectionSnapshot(JSON.parse(projectionJson));
      const resources = TrainingResourceSchema.array().max(500).parse(JSON.parse(trainingJson));
      const record = createCareerPathRecord({ profile, projection, evidenceGaps: parseLines(evidenceGaps), trainingResources: resources });
      setRecords(saveCareerPathRecord(record));
      setStatus(`Saved ${record.profile.occupationTitle}: ${record.trend.trend}. Only resources matching explicit evidence gaps were retained.`);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Career path could not be saved."); }
  }

  return <section className="rounded-xl border border-ink-700 bg-ink-900/70 p-4" aria-labelledby="career-path-heading">
    <div>
      <h2 id="career-path-heading" className="font-display text-xl font-semibold text-paper">Career path evidence</h2>
      <p className="text-[11px] text-ink-400">O*NET describes occupations. BLS time series show observations. Trend labels require a separate, current occupational-projection snapshot with full provenance.</p>
    </div>
    <p role="status" aria-live="polite" className="mt-2 text-xs text-brass-300">{status}</p>

    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
      <label className="text-xs text-ink-300">O*NET-SOC code
        <input value={occupationCode} onChange={(event) => setOccupationCode(event.target.value)} placeholder="15-1252.00" pattern="\d{2}-\d{4}\.\d{2}" maxLength={10} className="mt-1 block w-full rounded border border-ink-700 bg-ink-950 p-2 text-xs" />
      </label>
      <ToolButton disabled={working || !/^\d{2}-\d{4}\.\d{2}$/u.test(occupationCode.trim())} onClick={() => void lookupOnet()}>Look up O*NET</ToolButton>
    </div>
    {profile && <div className="mt-3 rounded border border-ink-700 bg-ink-950 p-3 text-xs text-ink-300">
      <strong className="text-paper">{profile.occupationTitle}</strong> <span className="font-mono text-[10px]">{profile.occupationCode}</span>
      <p className="mt-1">{profile.description}</p>
      <p className="mt-2 text-[10px] text-ink-400">Source: <a className="underline" href={profile.sourceUrl} target="_blank" rel="noreferrer">O*NET</a> · source date {profile.asOfDate} · retrieved {new Date(profile.retrievedAt).toLocaleString()}</p>
      <p className="mt-1 text-[10px] text-ink-400">{profile.uncertainty}</p>
    </div>}

    <details className="mt-3 rounded border border-ink-700 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-paper">Optional BLS observational series</summary>
      <p className="mt-1 text-[10px] text-ink-400">This does not create a projection. Series identifiers carry their own units and geography; verify them at BLS.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
        <label className="text-xs text-ink-300">Series IDs<input value={blsSeriesIds} onChange={(event) => setBlsSeriesIds(event.target.value)} placeholder="One or more IDs, comma-separated" className="mt-1 block w-full rounded border border-ink-700 bg-ink-950 p-2 text-xs" /></label>
        <label className="text-xs text-ink-300">Start year<input type="number" min="1900" max="2200" value={blsStartYear} onChange={(event) => setBlsStartYear(event.target.value)} className="mt-1 block w-full rounded border border-ink-700 bg-ink-950 p-2 text-xs" /></label>
        <label className="text-xs text-ink-300">End year<input type="number" min="1900" max="2200" value={blsEndYear} onChange={(event) => setBlsEndYear(event.target.value)} className="mt-1 block w-full rounded border border-ink-700 bg-ink-950 p-2 text-xs" /></label>
        <ToolButton disabled={working || parseLines(blsSeriesIds).length === 0} onClick={() => void lookupBlsSeries()}>Load observations</ToolButton>
      </div>
      {observations.map((series) => <div key={series.seriesId} className="mt-2 rounded bg-ink-950 p-2 text-[10px] text-ink-400"><strong className="text-paper">{series.seriesId}</strong> · {series.observations.length} observations · latest period {series.asOfPeriod ?? "not reported"} · retrieved {new Date(series.retrievedAt).toLocaleString()}<br />{series.geography}<br />{series.uncertainty}</div>)}
    </details>

    <div className="mt-3 grid gap-2 lg:grid-cols-2">
      <label className="text-xs text-ink-300">Authoritative projection snapshot (JSON)
        <textarea value={projectionJson} onChange={(event) => setProjectionJson(event.target.value)} rows={8} placeholder='Required: occupationCode, occupationTitle, geography, employmentLevel, medianWage, projectedGrowthPercent, annualOpenings, replacementOpenings, projectionStartYear, projectionEndYear, asOfDate, source:"BLS", sourceUrl, uncertainty, retrievedAt' className="mt-1 block w-full rounded border border-ink-700 bg-ink-950 p-2 font-mono text-[10px]" />
      </label>
      <div className="grid gap-2">
        <label className="text-xs text-ink-300">Explicit evidence gaps (one per line or comma-separated)
          <textarea value={evidenceGaps} onChange={(event) => setEvidenceGaps(event.target.value)} rows={3} className="mt-1 block w-full rounded border border-ink-700 bg-ink-950 p-2 text-xs" />
        </label>
        <label className="text-xs text-ink-300">Training resource catalog (JSON array)
          <textarea value={trainingJson} onChange={(event) => setTrainingJson(event.target.value)} rows={4} className="mt-1 block w-full rounded border border-ink-700 bg-ink-950 p-2 font-mono text-[10px]" />
        </label>
      </div>
    </div>
    <div className="mt-2"><ToolButton disabled={!profile || !projectionJson.trim()} onClick={savePath}>Validate and save path</ToolButton></div>

    {records.length > 0 && <ol className="mt-4 space-y-2" aria-label="Saved career paths">{records.map((record) => <li key={record.id} className="rounded border border-ink-700 bg-ink-950 p-3 text-xs text-ink-300">
      <div className="flex flex-wrap items-start justify-between gap-2"><div><strong className="text-paper">{record.profile.occupationTitle}</strong> · <span className="text-brass-300">{record.trend.trend}</span></div><button type="button" className="text-[10px] text-red-300 underline" onClick={() => setRecords(deleteCareerPathRecord(record.id))}>Delete path</button></div>
      <p className="mt-1">{record.trend.reasons.join(" ")}</p>
      <p className="mt-2 text-[10px] text-ink-400">{record.projection.geography} · projection {record.projection.projectionStartYear}–{record.projection.projectionEndYear} · source date {record.projection.asOfDate} · retrieved {new Date(record.projection.retrievedAt).toLocaleString()}</p>
      <p className="mt-1 text-[10px] text-ink-400">Source: <a className="underline" href={record.projection.sourceUrl} target="_blank" rel="noreferrer">{record.projection.source}</a>. {record.projection.uncertainty}</p>
      {record.evidenceGaps.length > 0 && <p className="mt-2">Evidence gaps: {record.evidenceGaps.join(", ")}</p>}
      {record.trainingRecommendations.length > 0 ? <ul className="mt-1 list-disc pl-5">{record.trainingRecommendations.map((item) => <li key={item.resource.id}><a className="underline" href={item.resource.sourceUrl} target="_blank" rel="noreferrer">{item.resource.title}</a> — {item.rationale} Source date {item.resource.asOfDate}.</li>)}</ul> : <p className="mt-1 text-[10px] text-ink-400">No training resource matched an explicit evidence gap; no generic recommendation was invented.</p>}
    </li>)}</ol>}
  </section>;
}
