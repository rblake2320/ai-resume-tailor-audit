export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { enforceConfiguredWindowsSensitivePathAcls } = await import(
    "./lib/windows-sensitive-path-acl"
  );
  await enforceConfiguredWindowsSensitivePathAcls();
}
