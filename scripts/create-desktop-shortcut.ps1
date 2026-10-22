[CmdletBinding()]
param([switch]$Check)

$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$launcher = Join-Path $taskRoot 'scripts\launch.ps1'
$powershellBinary = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$desktopDirectory = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopDirectory 'Words Actually Dance.lnk'
$packagedBinary = Join-Path $taskRoot 'dist\windows\Words Actually Dance\Words Actually Dance.exe'
$arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $launcher + '"'

foreach ($requiredPath in @($launcher, $powershellBinary, $desktopDirectory)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) { throw "找不到快捷方式所需路径：$requiredPath" }
}

if (-not ('WordsActuallyDance.WindowsShortcut' -as [type])) {
    Add-Type -Path (Join-Path $PSScriptRoot 'windows-shell-link.cs')
}
if (Test-Path -LiteralPath $shortcutPath) {
    $existing = [WordsActuallyDance.WindowsShortcut]::Read($shortcutPath)
    if ($existing.TargetPath -ne $powershellBinary -or $existing.Arguments -ne $arguments -or $existing.WorkingDirectory -ne $taskRoot) {
        throw '桌面已有同名且指向其他程序的快捷方式，未覆盖。'
    }
}
if ($Check) {
    [PSCustomObject]@{
        shortcut = $shortcutPath
        launcher = $launcher
        target = $powershellBinary
        exists = (Test-Path -LiteralPath $shortcutPath -PathType Leaf)
    } | ConvertTo-Json -Compress
    exit 0
}
$icon = if (Test-Path -LiteralPath $packagedBinary -PathType Leaf) { $packagedBinary } else { $powershellBinary }
[WordsActuallyDance.WindowsShortcut]::Save($shortcutPath, $powershellBinary, $arguments, $taskRoot, $icon)
$saved = [WordsActuallyDance.WindowsShortcut]::Read($shortcutPath)
if ($saved.TargetPath -ne $powershellBinary -or $saved.Arguments -ne $arguments -or $saved.WorkingDirectory -ne $taskRoot) {
    throw '快捷方式写入后的目标验证失败。'
}
[PSCustomObject]@{ shortcut = $shortcutPath; launcher = $launcher; target = $saved.TargetPath } | ConvertTo-Json -Compress
