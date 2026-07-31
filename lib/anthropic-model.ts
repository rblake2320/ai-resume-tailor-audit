export const DEFAULT_MODEL = "claude-opus-5";

/**
 * Resolves the Anthropic model id for the tailoring route.
 *
 * Only an app-specific variable may override the default. `ANTHROPIC_MODEL`
 * used to sit in a fallback chain here, and the Claude Code CLI sets that
 * variable globally — so on any machine with the CLI installed the route
 * resolved to the alias `opusplan`, which is not a valid API model id, and the
 * product's core request failed by default. A comment directly above the chain
 * asserted this could not happen; the chain itself was the defect.
 */
export function resolveModel(env: Record<string, string | undefined> = process.env): string {
  const configured = env.RESUME_FOUNDRY_ANTHROPIC_MODEL?.trim();
  if (!configured) return DEFAULT_MODEL;
  // Fail with an actionable message rather than forwarding an unknown
  // identifier and surfacing an opaque provider error at request time.
  if (!/^[a-z][a-z0-9.]*-[a-z0-9.-]+$/u.test(configured)) {
    throw new Error(
      `RESUME_FOUNDRY_ANTHROPIC_MODEL="${configured}" is not a valid Anthropic model id (expected e.g. "claude-opus-5"). ` +
      'CLI aliases such as "opusplan" are not API model ids.',
    );
  }
  return configured;
}
