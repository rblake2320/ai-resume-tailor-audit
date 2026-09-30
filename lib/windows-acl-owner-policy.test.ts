import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

describe.runIf(process.platform === "win32")("shipped PowerShell ACL ownership policy", () => {
  it("limits descendant ownership to existing full-control principals without weakening configured paths", async () => {
    // Execute the shipped Get-SecurityResult against in-memory Windows security
    // descriptors. No privilege is needed to vary descriptor ownership, so
    // every negative case runs on both ordinary and elevated Windows runners.
    const program = String.raw`
$ErrorActionPreference = 'Stop'
$source = Join-Path (Get-Location) 'scripts/windows-sensitive-path-acl.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count -gt 0) { throw 'Shipped ACL script failed to parse.' }
$function = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-SecurityResult' }, $true)
if ($null -eq $function) { throw 'Missing security function.' }
Invoke-Expression $function.Extent.Text
function Get-ItemAcl { return $script:fixtureAcl }
$current = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$system = 'S-1-5-18'; $admin = 'S-1-5-32-544'; $users = 'S-1-5-32-545'
$cases = @(
  @{name='root-current'; owner=$current; protected=$true},
  @{name='root-admin'; owner=$admin; protected=$true},
  @{name='root-system'; owner=$system; protected=$true},
  @{name='child-admin'; owner=$admin; protected=$false},
  @{name='child-system'; owner=$system; protected=$false},
  @{name='child-users'; owner=$users; protected=$false},
  @{name='child-admin-unexpected-allow'; owner=$admin; protected=$false; extra=$true},
  @{name='child-admin-deny'; owner=$admin; protected=$false; deny=$true},
  @{name='child-admin-missing-system'; owner=$admin; protected=$false; missing=$true}
)
$results = foreach ($case in $cases) {
  $script:fixtureAcl = [System.Security.AccessControl.DirectorySecurity]::new()
  $script:fixtureAcl.SetOwner([System.Security.Principal.SecurityIdentifier]::new($case.owner))
  $script:fixtureAcl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @($current, $system, $admin)) {
    if ($case.missing -and $sid -eq $system) { continue }
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', 'Allow')
    [void]$script:fixtureAcl.AddAccessRule($rule)
  }
  if ($case.extra) {
    [void]$script:fixtureAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new($users), 'Read', 'Allow'))
  }
  if ($case.deny) {
    [void]$script:fixtureAcl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new($current), 'Write', 'Deny'))
  }
  $result = Get-SecurityResult -LiteralPath 'synthetic' -ItemKind 'directory' -RequireProtected $case.protected
  [pscustomobject]@{name=$case.name; secure=$result.secure}
}
$results | ConvertTo-Json -Compress
`;
    const { stdout } = await run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(program, "utf16le").toString("base64")], { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 });
    expect(JSON.parse(stdout)).toEqual([
      { name: "root-current", secure: true },
      { name: "root-admin", secure: false },
      { name: "root-system", secure: false },
      { name: "child-admin", secure: true },
      { name: "child-system", secure: true },
      { name: "child-users", secure: false },
      { name: "child-admin-unexpected-allow", secure: false },
      { name: "child-admin-deny", secure: false },
      { name: "child-admin-missing-system", secure: false },
    ]);
  }, 15_000);
});
