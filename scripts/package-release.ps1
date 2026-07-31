[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$OutputPath,

    [ValidateNotNullOrEmpty()]
    [string]$ManifestPath,

    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$fixedZipTimestamp = [DateTimeOffset]::new(
    2000,
    1,
    1,
    0,
    0,
    0,
    [TimeSpan]::Zero
)

$requiredRootFiles = @(
    '.gitignore',
    'package.json',
    'package-lock.json',
    'README.md',
    'data/azzurro-reviews.sqlite'
)

$requiredRootDirectories = @(
    'config',
    'dashboard',
    'scripts',
    'src',
    'test'
)

$excludedDirectoryNames = [System.Collections.Generic.HashSet[string]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
)
@(
    '.git',
    '.next',
    '.vinext',
    '.vite',
    '.vite-temp',
    '.wrangler',
    'coverage',
    'dist',
    'exports',
    'logs',
    'node_modules'
) | ForEach-Object {
    [void]$excludedDirectoryNames.Add($_)
}

function Get-Sha256Hex {
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [byte[]]$Bytes
    )

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $digest = $sha256.ComputeHash($Bytes)
        return (($digest | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    finally {
        $sha256.Dispose()
    }
}

function Test-IsReparsePoint {
    param(
        [Parameter(Mandatory = $true)]
        [System.IO.FileSystemInfo]$Item
    )

    return (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
}

function Test-IsExcludedArtifact {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ArchivePath
    )

    if (
        $ArchivePath.Equals(
            'data/azzurro-reviews.sqlite',
            [System.StringComparison]::OrdinalIgnoreCase
        )
    ) {
        return $false
    }

    $segments = $ArchivePath -split '/'
    foreach ($segment in $segments) {
        if ($excludedDirectoryNames.Contains($segment)) {
            return $true
        }
    }

    $leafName = $segments[$segments.Length - 1]
    if (
        $leafName.Equals('.env', [System.StringComparison]::OrdinalIgnoreCase) -or
        $leafName.StartsWith('.env.', [System.StringComparison]::OrdinalIgnoreCase)
    ) {
        return $true
    }

    $lowerLeafName = $leafName.ToLowerInvariant()
    foreach ($suffix in @(
        '.har',
        '.log',
        '.db',
        '.db-shm',
        '.db-wal',
        '.sqlite',
        '.sqlite-shm',
        '.sqlite-wal',
        '.tsbuildinfo'
    )) {
        if ($lowerLeafName.EndsWith($suffix, [System.StringComparison]::Ordinal)) {
            return $true
        }
    }

    return $false
}

function Get-ArchivePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FullName,

        [Parameter(Mandatory = $true)]
        [string]$SourceRootWithSeparator
    )

    $resolvedFullName = [System.IO.Path]::GetFullPath($FullName)
    if (
        -not $resolvedFullName.StartsWith(
            $SourceRootWithSeparator,
            [System.StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "Refusing to package a path outside the project root: $resolvedFullName"
    }

    return $resolvedFullName.Substring($SourceRootWithSeparator.Length).Replace('\', '/')
}

function Add-FileSnapshot {
    param(
        [Parameter(Mandatory = $true)]
        [System.IO.FileInfo]$File,

        [Parameter(Mandatory = $true)]
        [string]$SourceRootWithSeparator,

        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.Dictionary[string, object]]$Snapshots,

        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[string]]$ExcludedPaths
    )

    if (Test-IsReparsePoint -Item $File) {
        throw "Refusing to package a symbolic link or reparse point: $($File.FullName)"
    }

    $archivePath = Get-ArchivePath `
        -FullName $File.FullName `
        -SourceRootWithSeparator $SourceRootWithSeparator

    if (Test-IsExcludedArtifact -ArchivePath $archivePath) {
        $ExcludedPaths.Add($archivePath)
        return
    }

    if ($Snapshots.ContainsKey($archivePath)) {
        throw "Duplicate archive path detected: $archivePath"
    }

    $bytes = [System.IO.File]::ReadAllBytes($File.FullName)
    $Snapshots.Add(
        $archivePath,
        [pscustomobject]@{
            Bytes = $bytes
            Hash = Get-Sha256Hex -Bytes $bytes
        }
    )
}

function Add-DirectorySnapshots {
    param(
        [Parameter(Mandatory = $true)]
        [System.IO.DirectoryInfo]$Directory,

        [Parameter(Mandatory = $true)]
        [string]$SourceRootWithSeparator,

        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.Dictionary[string, object]]$Snapshots,

        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [System.Collections.Generic.List[string]]$ExcludedPaths
    )

    if (Test-IsReparsePoint -Item $Directory) {
        throw "Refusing to traverse a symbolic link or reparse point: $($Directory.FullName)"
    }

    foreach ($child in Get-ChildItem -Force -LiteralPath $Directory.FullName) {
        $archivePath = Get-ArchivePath `
            -FullName $child.FullName `
            -SourceRootWithSeparator $SourceRootWithSeparator

        if ($child.PSIsContainer) {
            $segments = $archivePath -split '/'
            if ($excludedDirectoryNames.Contains($segments[$segments.Length - 1])) {
                $ExcludedPaths.Add("$archivePath/")
                continue
            }

            if (Test-IsReparsePoint -Item $child) {
                throw "Refusing to traverse a symbolic link or reparse point: $($child.FullName)"
            }

            Add-DirectorySnapshots `
                -Directory $child `
                -SourceRootWithSeparator $SourceRootWithSeparator `
                -Snapshots $Snapshots `
                -ExcludedPaths $ExcludedPaths
            continue
        }

        Add-FileSnapshot `
            -File $child `
            -SourceRootWithSeparator $SourceRootWithSeparator `
            -Snapshots $Snapshots `
            -ExcludedPaths $ExcludedPaths
    }
}

function Write-DeterministicZip {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ZipPath,

        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.List[string]]$ArchivePaths,

        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.Dictionary[string, object]]$Snapshots
    )

    $fileStream = [System.IO.File]::Open(
        $ZipPath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )

    try {
        $zipArchive = [System.IO.Compression.ZipArchive]::new(
            $fileStream,
            [System.IO.Compression.ZipArchiveMode]::Create,
            $true
        )

        try {
            foreach ($archivePath in $ArchivePaths) {
                $entry = $zipArchive.CreateEntry(
                    $archivePath,
                    [System.IO.Compression.CompressionLevel]::Optimal
                )
                $entry.LastWriteTime = $fixedZipTimestamp
                $entry.ExternalAttributes = 0

                $entryStream = $entry.Open()
                try {
                    $bytes = $Snapshots[$archivePath].Bytes
                    $entryStream.Write($bytes, 0, $bytes.Length)
                }
                finally {
                    $entryStream.Dispose()
                }
            }
        }
        finally {
            $zipArchive.Dispose()
        }
    }
    finally {
        $fileStream.Dispose()
    }
}

function Assert-ZipMatchesSnapshots {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ZipPath,

        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.List[string]]$ArchivePaths,

        [Parameter(Mandatory = $true)]
        [System.Collections.Generic.Dictionary[string, object]]$Snapshots
    )

    $fileStream = [System.IO.File]::OpenRead($ZipPath)
    try {
        $zipArchive = [System.IO.Compression.ZipArchive]::new(
            $fileStream,
            [System.IO.Compression.ZipArchiveMode]::Read,
            $true
        )

        try {
            if ($zipArchive.Entries.Count -ne $ArchivePaths.Count) {
                throw (
                    "Archive verification failed: expected {0} entries, found {1}." -f
                    $ArchivePaths.Count,
                    $zipArchive.Entries.Count
                )
            }

            $seenPaths = [System.Collections.Generic.HashSet[string]]::new(
                [System.StringComparer]::Ordinal
            )

            foreach ($entry in $zipArchive.Entries) {
                if (-not $seenPaths.Add($entry.FullName)) {
                    throw "Archive verification failed: duplicate entry $($entry.FullName)"
                }

                if (-not $Snapshots.ContainsKey($entry.FullName)) {
                    throw "Archive verification failed: unexpected entry $($entry.FullName)"
                }

                $entryStream = $entry.Open()
                try {
                    $memoryStream = [System.IO.MemoryStream]::new()
                    try {
                        $entryStream.CopyTo($memoryStream)
                        $actualHash = Get-Sha256Hex -Bytes $memoryStream.ToArray()
                    }
                    finally {
                        $memoryStream.Dispose()
                    }
                }
                finally {
                    $entryStream.Dispose()
                }

                $expectedHash = $Snapshots[$entry.FullName].Hash
                if (
                    -not $actualHash.Equals(
                        $expectedHash,
                        [System.StringComparison]::Ordinal
                    )
                ) {
                    throw "Archive verification failed: content mismatch for $($entry.FullName)"
                }
            }

            foreach ($archivePath in $ArchivePaths) {
                if (-not $seenPaths.Contains($archivePath)) {
                    throw "Archive verification failed: missing entry $archivePath"
                }
            }
        }
        finally {
            $zipArchive.Dispose()
        }
    }
    finally {
        $fileStream.Dispose()
    }
}

$sourceRoot = [System.IO.Path]::GetFullPath(
    (Split-Path -Parent $PSScriptRoot)
).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
)
$sourceRootWithSeparator = "$sourceRoot$([System.IO.Path]::DirectorySeparatorChar)"

$outputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
if (
    -not [System.IO.Path]::GetExtension($outputFullPath).Equals(
        '.zip',
        [System.StringComparison]::OrdinalIgnoreCase
    )
) {
    throw "OutputPath must end in .zip: $outputFullPath"
}

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $manifestFullPath = "$outputFullPath.sha256"
}
else {
    $manifestFullPath = [System.IO.Path]::GetFullPath($ManifestPath)
}

if (
    $outputFullPath.Equals(
        $manifestFullPath,
        [System.StringComparison]::OrdinalIgnoreCase
    )
) {
    throw 'OutputPath and ManifestPath must be different files.'
}

foreach ($targetPath in @($outputFullPath, $manifestFullPath)) {
    if ([System.IO.Directory]::Exists($targetPath)) {
        throw "A directory already exists at the requested file path: $targetPath"
    }

    if ([System.IO.File]::Exists($targetPath) -and -not $Force) {
        throw "Refusing to overwrite an existing file without -Force: $targetPath"
    }
}

$snapshots = [System.Collections.Generic.Dictionary[string, object]]::new(
    [System.StringComparer]::OrdinalIgnoreCase
)
$excludedPaths = [System.Collections.Generic.List[string]]::new()

foreach ($relativePath in $requiredRootFiles) {
    $fullPath = Join-Path -Path $sourceRoot -ChildPath $relativePath
    if (-not [System.IO.File]::Exists($fullPath)) {
        throw "Required release file is missing: $relativePath"
    }

    Add-FileSnapshot `
        -File (Get-Item -Force -LiteralPath $fullPath) `
        -SourceRootWithSeparator $sourceRootWithSeparator `
        -Snapshots $snapshots `
        -ExcludedPaths $excludedPaths
}

foreach ($relativePath in $requiredRootDirectories) {
    $fullPath = Join-Path -Path $sourceRoot -ChildPath $relativePath
    if (-not [System.IO.Directory]::Exists($fullPath)) {
        throw "Required release directory is missing: $relativePath"
    }

    Add-DirectorySnapshots `
        -Directory (Get-Item -Force -LiteralPath $fullPath) `
        -SourceRootWithSeparator $sourceRootWithSeparator `
        -Snapshots $snapshots `
        -ExcludedPaths $excludedPaths
}

$archivePaths = [System.Collections.Generic.List[string]]::new()
foreach ($archivePath in $snapshots.Keys) {
    $archivePaths.Add($archivePath)
}
$archivePaths.Sort([System.StringComparer]::Ordinal)

if ($archivePaths.Count -eq 0) {
    throw 'The release allowlist produced an empty archive.'
}

$outputDirectory = [System.IO.Path]::GetDirectoryName($outputFullPath)
$manifestDirectory = [System.IO.Path]::GetDirectoryName($manifestFullPath)
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
[System.IO.Directory]::CreateDirectory($manifestDirectory) | Out-Null

$temporaryZipPath = Join-Path `
    -Path $outputDirectory `
    -ChildPath (
        '.{0}.{1}.tmp' -f
        [System.IO.Path]::GetFileName($outputFullPath),
        [Guid]::NewGuid().ToString('N')
    )
$temporaryManifestPath = Join-Path `
    -Path $manifestDirectory `
    -ChildPath (
        '.{0}.{1}.tmp' -f
        [System.IO.Path]::GetFileName($manifestFullPath),
        [Guid]::NewGuid().ToString('N')
    )

try {
    Write-DeterministicZip `
        -ZipPath $temporaryZipPath `
        -ArchivePaths $archivePaths `
        -Snapshots $snapshots

    Assert-ZipMatchesSnapshots `
        -ZipPath $temporaryZipPath `
        -ArchivePaths $archivePaths `
        -Snapshots $snapshots

    $archiveHash = (
        Get-FileHash -Algorithm SHA256 -LiteralPath $temporaryZipPath
    ).Hash.ToLowerInvariant()
    $manifestLine = '{0}  {1}{2}' -f
        $archiveHash,
        [System.IO.Path]::GetFileName($outputFullPath),
        "`n"
    [System.IO.File]::WriteAllText(
        $temporaryManifestPath,
        $manifestLine,
        [System.Text.UTF8Encoding]::new($false)
    )

    Move-Item -LiteralPath $temporaryZipPath -Destination $outputFullPath -Force:$Force
    Move-Item `
        -LiteralPath $temporaryManifestPath `
        -Destination $manifestFullPath `
        -Force:$Force
}
finally {
    if ([System.IO.File]::Exists($temporaryZipPath)) {
        Remove-Item -LiteralPath $temporaryZipPath -Force
    }
    if ([System.IO.File]::Exists($temporaryManifestPath)) {
        Remove-Item -LiteralPath $temporaryManifestPath -Force
    }
}

Write-Output "Release ZIP: $outputFullPath"
Write-Output "SHA-256: $archiveHash"
Write-Output "Manifest: $manifestFullPath"
Write-Output "Archived files: $($archivePaths.Count)"
Write-Output "Excluded artifacts: $($excludedPaths.Count)"
