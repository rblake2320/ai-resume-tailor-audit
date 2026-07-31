param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("apply", "verify", "preflight")]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$TargetPath,

  [Parameter(Mandatory = $true)]
  [ValidateSet("directory", "file")]
  [string]$Kind
)

$ErrorActionPreference = "Stop"
$reparsePoint = [System.IO.FileAttributes]::ReparsePoint
$directoryAttribute = [System.IO.FileAttributes]::Directory

function Assert-NoReparseComponents([string]$LiteralPath) {
  $fullPath = [System.IO.Path]::GetFullPath($LiteralPath)
  $root = [System.IO.Path]::GetPathRoot($fullPath)
  $current = $root
  $relative = $fullPath.Substring($root.Length)
  foreach ($segment in $relative.Split(
    [char[]]@([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar),
    [System.StringSplitOptions]::RemoveEmptyEntries
  )) {
    $current = [System.IO.Path]::Combine($current, $segment)
    if (-not ([System.IO.Directory]::Exists($current) -or [System.IO.File]::Exists($current))) {
      break
    }
    $attributes = [System.IO.File]::GetAttributes($current)
    if (($attributes -band $reparsePoint) -ne 0) {
      throw "Reparse points are forbidden in sensitive storage paths."
    }
  }
}

function Get-CheckedItems([string]$LiteralPath, [string]$ItemKind) {
  Assert-NoReparseComponents -LiteralPath $LiteralPath
  $items = [System.Collections.Generic.List[object]]::new()
  $pending = [System.Collections.Generic.Stack[object]]::new()
  $pending.Push([pscustomobject]@{ Path = $LiteralPath; Kind = $ItemKind })
  while ($pending.Count -gt 0) {
    $candidate = $pending.Pop()
    $attributes = [System.IO.File]::GetAttributes($candidate.Path)
    if (($attributes -band $reparsePoint) -ne 0) {
      throw "Reparse points are forbidden in sensitive storage trees."
    }
    $actualKind = if (($attributes -band $directoryAttribute) -ne 0) { "directory" } else { "file" }
    if ($actualKind -ne $candidate.Kind) { throw "TargetPath does not match Kind." }
    $items.Add([pscustomobject]@{ Path = $candidate.Path; Kind = $actualKind })
    if ($actualKind -eq "directory") {
      foreach ($child in [System.IO.Directory]::EnumerateFileSystemEntries($candidate.Path)) {
        $childAttributes = [System.IO.File]::GetAttributes($child)
        if (($childAttributes -band $reparsePoint) -ne 0) {
          throw "Reparse points are forbidden in sensitive storage trees."
        }
        $childKind = if (($childAttributes -band $directoryAttribute) -ne 0) { "directory" } else { "file" }
        $pending.Push([pscustomobject]@{ Path = $child; Kind = $childKind })
      }
    }
  }
  return $items
}

function Get-ItemAcl([string]$LiteralPath, [string]$ItemKind) {
  if ($ItemKind -eq "directory") {
    return [System.IO.Directory]::GetAccessControl($LiteralPath)
  }
  return [System.IO.File]::GetAccessControl($LiteralPath)
}

function Set-ItemAcl([string]$LiteralPath, [string]$ItemKind, $Acl) {
  if ($ItemKind -eq "directory") {
    [System.IO.Directory]::SetAccessControl($LiteralPath, $Acl)
  } else {
    [System.IO.File]::SetAccessControl($LiteralPath, $Acl)
  }
}

function Get-SecurityResult([string]$LiteralPath, [string]$ItemKind, [bool]$RequireProtected) {
  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")
  $administratorsSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
  $requiredSids = @($currentSid.Value, $systemSid.Value, $administratorsSid.Value)
  $acl = Get-ItemAcl -LiteralPath $LiteralPath -ItemKind $ItemKind
  $ownerSid = ([System.Security.Principal.NTAccount]$acl.Owner).Translate(
    [System.Security.Principal.SecurityIdentifier]
  ).Value
  $rules = @($acl.GetAccessRules(
    $true,
    $true,
    [System.Security.Principal.SecurityIdentifier]
  ))
  $unexpectedAllowSids = @(
    $rules |
      Where-Object {
        $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
        $requiredSids -notcontains $_.IdentityReference.Value
      } |
      ForEach-Object { $_.IdentityReference.Value } |
      Sort-Object -Unique
  )
  $denyRuleCount = @(
    $rules | Where-Object {
      $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Deny
    }
  ).Count
  $inheritedRuleCount = @($rules | Where-Object { $_.IsInherited }).Count
  $missingFullControlSids = @(
    foreach ($sid in $requiredSids) {
      $hasUsableFullControl = @(
        $rules | Where-Object {
          $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and
          $_.IdentityReference.Value -eq $sid -and
          -not ($_.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -and
          ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq
            [System.Security.AccessControl.FileSystemRights]::FullControl
        }
      ).Count -gt 0
      if (-not $hasUsableFullControl) { $sid }
    }
  )
  $secure =
    ((-not $RequireProtected) -or $acl.AreAccessRulesProtected) -and
    $ownerSid -eq $currentSid.Value -and
    $unexpectedAllowSids.Count -eq 0 -and
    $denyRuleCount -eq 0 -and
    $missingFullControlSids.Count -eq 0

  return [pscustomobject]@{
    secure = $secure
    ownerSid = $ownerSid
    inheritanceProtected = $acl.AreAccessRulesProtected
    unexpectedAllowSids = $unexpectedAllowSids
    currentUserHasFullControl = $missingFullControlSids -notcontains $currentSid.Value
    missingFullControlSids = $missingFullControlSids
    denyRuleCount = $denyRuleCount
    inheritedRuleCount = $inheritedRuleCount
  }
}

function Protect-Item([string]$LiteralPath, [string]$ItemKind) {
  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $systemSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-18")
  $administratorsSid = [System.Security.Principal.SecurityIdentifier]::new("S-1-5-32-544")
  $acl = Get-ItemAcl -LiteralPath $LiteralPath -ItemKind $ItemKind
  $acl.SetOwner($currentSid)
  $acl.SetAccessRuleProtection($true, $false)
  $ruleSids = @(
    $acl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier]) |
      ForEach-Object { $_.IdentityReference.Value } |
      Sort-Object -Unique
  )
  foreach ($sidValue in $ruleSids) {
    $acl.PurgeAccessRules([System.Security.Principal.SecurityIdentifier]::new($sidValue))
  }
  $inheritance = if ($ItemKind -eq "directory") {
    [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    [System.Security.AccessControl.InheritanceFlags]::None
  }
  foreach ($sid in @($currentSid, $systemSid, $administratorsSid)) {
    $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
      $sid,
      [System.Security.AccessControl.FileSystemRights]::FullControl,
      $inheritance,
      [System.Security.AccessControl.PropagationFlags]::None,
      [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$acl.AddAccessRule($rule)
  }
  Set-ItemAcl -LiteralPath $LiteralPath -ItemKind $ItemKind -Acl $acl
}

$fullTarget = [System.IO.Path]::GetFullPath($TargetPath)
if ($Mode -eq "preflight") {
  Assert-NoReparseComponents -LiteralPath $fullTarget
  [pscustomobject]@{
    secure = $true
    ownerSid = ""
    inheritanceProtected = $false
    unexpectedAllowSids = @()
    currentUserHasFullControl = $false
    missingFullControlSids = @()
    denyRuleCount = 0
    inheritedRuleCount = 0
    checkedItemCount = 0
  } | ConvertTo-Json -Compress
  exit 0
}
$items = @(Get-CheckedItems -LiteralPath $fullTarget -ItemKind $Kind)
if ($Mode -eq "apply") {
  foreach ($item in $items) {
    Protect-Item -LiteralPath $item.Path -ItemKind $item.Kind
  }
  $items = @(Get-CheckedItems -LiteralPath $fullTarget -ItemKind $Kind)
}

$firstFailure = $null
foreach ($item in $items) {
  $requireProtected = $item.Path -eq $fullTarget
  $result = Get-SecurityResult -LiteralPath $item.Path -ItemKind $item.Kind -RequireProtected $requireProtected
  if (-not $result.secure -and $null -eq $firstFailure) { $firstFailure = $result }
}
if ($null -ne $firstFailure) {
  $firstFailure | Add-Member -NotePropertyName checkedItemCount -NotePropertyValue $items.Count
  $firstFailure | ConvertTo-Json -Compress
  exit 3
}

$success = Get-SecurityResult -LiteralPath $fullTarget -ItemKind $Kind -RequireProtected $true
$success | Add-Member -NotePropertyName checkedItemCount -NotePropertyValue $items.Count
$success | ConvertTo-Json -Compress
