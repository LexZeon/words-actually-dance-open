[CmdletBinding()]
param([switch]$Check)

$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packagedBinary = Join-Path $taskRoot 'dist\windows\Words Actually Dance\Words Actually Dance.exe'
$developmentBinary = Join-Path $taskRoot 'node_modules\electron\dist\electron.exe'

try {
    if (Test-Path -LiteralPath $packagedBinary -PathType Leaf) {
        $launchMode = 'portable'
        $launchBinary = $packagedBinary
        $launchDirectory = Split-Path -Parent $packagedBinary
        $launchArguments = $null
        $applicationRoot = Join-Path $launchDirectory 'resources\app'
    } elseif (Test-Path -LiteralPath $developmentBinary -PathType Leaf) {
        $launchMode = 'development'
        $launchBinary = $developmentBinary
        $launchDirectory = $taskRoot
        $launchArguments = '"' + $taskRoot + '"'
        $applicationRoot = $taskRoot
    } else {
        throw '未找到便携版或本地 Electron。请先生成 Windows 便携版；开发环境请按 README.md 完成项目依赖安装。启动器不会自动下载或安装。'
    }

    foreach ($requiredFile in @('package.json', 'electron\main.cjs', 'src\index.html')) {
        if (-not (Test-Path -LiteralPath (Join-Path $applicationRoot $requiredFile) -PathType Leaf)) {
            throw ('程序文件不完整，缺少 ' + $requiredFile + '。请保留整个程序文件夹，或重新生成便携版。')
        }
    }

    if ($Check) {
        [PSCustomObject]@{
            mode = $launchMode
            executable = $launchBinary
            workingDirectory = $launchDirectory
            arguments = $launchArguments
        } | ConvertTo-Json -Compress
        exit 0
    }

    if ($launchArguments) {
        Start-Process -FilePath $launchBinary -ArgumentList $launchArguments -WorkingDirectory $launchDirectory -WindowStyle Hidden
    } else {
        Start-Process -FilePath $launchBinary -WorkingDirectory $launchDirectory -WindowStyle Hidden
    }
    exit 0
} catch {
    [Console]::Error.WriteLine('启动失败：' + $_.Exception.Message)
    exit 1
}
