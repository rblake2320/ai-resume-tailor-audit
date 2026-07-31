/**
 * Deterministic, client-runnable ATS keyword scan.
 *
 * This is intentionally simple and transparent: it is the "show your work"
 * layer that runs instantly in the browser before the AI pass, so the user can
 * see exactly which job-posting terms appear in their resume and which don't.
 * The AI pass does the deep, contextual analysis; this one is auditable.
 */

const STOPWORDS = new Set(
  `a an and are as at be been being but by can could did do does doing for from
   had has have having he her here hers him his how i if in into is it its just
   me more most my no nor not of on once only or other our ours out over own s
   same she should so some such t than that the their theirs them then there
   these they this those through to too under until up very was we were what
   when where which while who whom why will with you your yours yourself
   about above after again against all am any because before below between both
   down during each few further he'd he'll he's here's how's i'd i'll i'm i've
   it's let's ourselves she'd she'll she's that's there's they'd they'll
   they're they've wasn't we'd we'll we're we've weren't what's when's where's
   who's why's won't wouldn't you'd you'll you're you've
   ability able across also among apply applicant applicants applications
   candidate candidates company day days employee employees employer equal
   experience including job like may must new opportunity opportunities per
   plus position preferred qualifications range required requirements
   responsibilities role salary status strong team the this well will within
   work working year years etc eg ie
   build builds building built operate operates operating operation using use
   uses used help helps helping ensure ensures ensuring provide provides
   providing deliver delivers leverage leverages utilize utilizes service
   services support supports maintain maintains
   ignore ignores ignoring instruction instructions disregard override
   overriding reveal system prompt prompts untrusted`
    .split(/\s+/)
    .filter(Boolean),
);

const normalize = (s: string) => s.toLowerCase().normalize("NFKD");

// Negation cues that, when they sit in the same clause just before a keyword,
// mean the resume is DISCLAIMING the skill ("no Kubernetes", "not familiar with
// Terraform", "without Go experience") rather than claiming it.
const NEGATION =
  /\b(no|not|never|without|lacks?|lacking|zero|none|unfamiliar|excluding|dont|doesnt|didnt|havent|hasnt|hadnt|isnt|arent|wasnt|werent|cant|cannot)\b[^.;:!?\n]*$/;

/**
 * True only if `keyword` appears in `resume` at least once WITHOUT a preceding
 * negation cue in the same clause. Prevents a disclaimer like "no Kubernetes
 * experience" from counting Kubernetes as a matched skill.
 */
function affirmativelyPresent(resume: string, keyword: string): boolean {
  const kw = keyword.replace(/[.*+?^${}()|[\]\\]/g, "");
  if (!kw) return false;
  let idx = resume.indexOf(kw);
  while (idx !== -1) {
    const before = resume.slice(Math.max(0, idx - 48), idx);
    if (!NEGATION.test(before)) return true; // an affirmative mention exists
    idx = resume.indexOf(kw, idx + kw.length);
  }
  return false;
}

function tokens(text: string): string[] {
  return normalize(text)
    .replace(/[^a-z0-9+#./-]+/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[./-]+|[./-]+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

export interface KeywordHit {
  keyword: string;
  count: number;
  inResume: boolean;
}

export interface AtsScan {
  keywords: KeywordHit[];
  matched: number;
  total: number;
  /** 0-100: share of top job keywords found in the resume */
  coverage: number;
}

/** Extract the most significant single terms and bigrams from a job description. */
export function extractKeywords(jobDescription: string, limit = 25): { keyword: string; count: number }[] {
  const toks = tokens(jobDescription);
  const counts = new Map<string, number>();

  for (const t of toks) counts.set(t, (counts.get(t) ?? 0) + 1);

  // Bigrams like "machine learning" / "project management" outrank their parts.
  for (let i = 0; i < toks.length - 1; i++) {
    const bigram = `${toks[i]} ${toks[i + 1]}`;
    counts.set(bigram, (counts.get(bigram) ?? 0) + 1);
  }

  const entries = [...counts.entries()]
    .filter(([k, c]) => (k.includes(" ") ? c >= 2 : c >= 2 || k.length > 3))
    .sort((a, b) => {
      const weight = (e: [string, number]) => e[1] * (e[0].includes(" ") ? 2.5 : 1);
      return weight(b) - weight(a);
    });

  // Drop single terms fully covered by a kept bigram.
  const kept: { keyword: string; count: number }[] = [];
  for (const [keyword, count] of entries) {
    if (kept.length >= limit) break;
    if (!keyword.includes(" ") && kept.some((k) => k.keyword.includes(keyword))) continue;
    kept.push({ keyword, count });
  }
  return kept;
}

/** Scan a resume against a job description. Pure, instant, no API. */
export function scanResume(resumeText: string, jobDescription: string, limit = 25): AtsScan {
  const resume = normalize(resumeText);
  const keywords = extractKeywords(jobDescription, limit).map(({ keyword, count }) => ({
    keyword,
    count,
    inResume: affirmativelyPresent(resume, keyword),
  }));
  const matched = keywords.filter((k) => k.inResume).length;
  const total = keywords.length;
  return {
    keywords,
    matched,
    total,
    coverage: total === 0 ? 0 : Math.round((matched / total) * 100),
  };
}
