param(
  [ValidateSet('Snapshot', 'Restore')][string]$Mode = 'Snapshot',
  [string]$SnapshotFile
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$entryName = 'local.yinian.muyu'
$entryKeys = @(
  'Software\Microsoft\Windows\CurrentVersion\Run',
  'Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
)
function Read-StartupState {
  $result = @()
  foreach ($entryPath in $entryKeys) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($entryPath, $false)
    try {
      $exists = $null -ne $key -and $key.GetValueNames() -contains $entryName
      $item = [ordered]@{ key = $entryPath; name = $entryName; exists = $exists }
      if ($exists) {
        $item.kind = $key.GetValueKind($entryName).ToString()
        $item.data = $key.GetValue($entryName, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      }
      $result += $item
    } finally { if ($null -ne $key) { $key.Dispose() } }
  }
  return $result
}
if ($Mode -eq 'Restore') {
  if (-not $SnapshotFile) { throw 'A saved snapshot is required.' }
  [object[]]$saved = ConvertFrom-Json -InputObject (Get-Content -LiteralPath $SnapshotFile -Raw -Encoding UTF8)
  if ($saved.Count -ne 2) { throw 'Unexpected startup snapshot.' }
  foreach ($item in $saved) {
    if ($item.name -ne $entryName -or $item.key -notin $entryKeys) { throw 'Snapshot targets an unrelated registry entry.' }
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($item.key, $true)
    try {
      if ($item.exists) {
        if ($null -eq $key) { $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($item.key) }
        $kind = [Microsoft.Win32.RegistryValueKind][Enum]::Parse([Microsoft.Win32.RegistryValueKind], $item.kind)
        $value = $item.data
        if ($item.kind -eq 'Binary') { $value = [byte[]]$item.data }
        elseif ($item.kind -eq 'DWord') { $value = [int]$item.data }
        elseif ($item.kind -eq 'QWord') { $value = [long]$item.data }
        elseif ($item.kind -eq 'MultiString') { $value = [string[]]$item.data }
        $key.SetValue($entryName, $value, $kind)
      } elseif ($null -ne $key) {
        $key.DeleteValue($entryName, $false)
      }
    } finally { if ($null -ne $key) { $key.Dispose() } }
  }
}
ConvertTo-Json -InputObject @(Read-StartupState) -Depth 6 -Compress
