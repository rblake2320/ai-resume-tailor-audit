param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("apply", "verify")]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$TargetPath,

  [Parameter(Mandatory = $true)]
  [ValidateSet("directory", "file")]
  [string]$Kind
)

$ErrorActionPreference = "Stop"

function Get-SecurityResult([string]$LiteralPath, [string]$ItemKind) {
  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")
  $administratorsSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
  $allowedSids = @($currentSid.Value, $systemSid.Value, $administratorsSid.Value)
  if ($ItemKind -eq "directory") {
    $acl = [System.IO.Directory]::GetAccessControl($LiteralPath)
  } else {
    $acl = [System.IO.File]::GetAccessControl($LiteralPath)
  }
  $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
    [System.Security.Principal.SecurityIdentifier]
  ).Value
  $rules = $acl.GetAccessRules(
    $true,
    $true,
    [System.Security.Principal.SecurityIdentifier]
  )
  $unexpectedAllowSids = @(
    $rules |
      Where-Object {
        $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
        $allowedSids -notcontains $_.IdentityReference.Value
      } |
      ForEach-Object { $_.IdentityReference.Value } |
      Sort-Object -Unique
  )
  $currentUserHasFullControl = @(
    $rules |
      Where-Object {
        $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
        $_.IdentityReference.Value -eq $currentSid.Value -and
        ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq
          [System.Security.AccessControl.FileSystemRights]::FullControl
      }
  ).Count -gt 0
  $secure =
    $acl.AreAccessRulesProtected -and
    $ownerSid -eq $currentSid.Value -and
    $unexpectedAllowSids.Count -eq 0 -and
    $currentUserHasFullControl

  [pscustomobject]@{
    secure = $secure
    ownerSid = $ownerSid
    inheritanceProtected = $acl.AreAccessRulesProtected
    unexpectedAllowSids = $unexpectedAllowSids
    currentUserHasFullControl = $currentUserHasFullControl
  }
}

$resolved = (Resolve-Path -LiteralPath $TargetPath).Path
$item = Get-Item -LiteralPath $resolved -Force
if (($Kind -eq "directory") -ne $item.PSIsContainer) {
  throw "TargetPath does not match Kind."
}

if ($Mode -eq "apply") {
  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")
  $administratorsSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
  if ($Kind -eq "directory") {
    $acl = [System.IO.Directory]::GetAccessControl($resolved)
  } else {
    $acl = [System.IO.File]::GetAccessControl($resolved)
  }
  $acl.SetOwner($currentSid)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.Access)) {
    [void]$acl.RemoveAccessRuleAll($rule)
  }
  if ($Kind -eq "directory") {
    $inheritance =
      [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
  }
  $propagation = [System.Security.AccessControl.PropagationFlags]::None
  foreach ($sid in @($currentSid, $systemSid, $administratorsSid)) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      $inheritance,
      $propagation,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
  }
  if ($Kind -eq "directory") {
    [System.IO.Directory]::SetAccessControl($resolved, $acl)
  } else {
    [System.IO.File]::SetAccessControl($resolved, $acl)
  }
}

$result = Get-SecurityResult -LiteralPath $resolved -ItemKind $Kind
$result | ConvertTo-Json -Compress
if (-not $result.secure) { exit 3 }
