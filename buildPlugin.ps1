# PowerShell build script — Windows counterpart to buildPlugin.sh.
#
# Both scripts produce the same artifact (build/outputs/SnDict.snplg)
# and run the same logical steps: prepare base dictionary -> Metro
# bundle -> sync versions into PluginConfig.json -> detect ReactPackages
# -> (optionally) build APK -> zip & rename to .snplg. Keep them in
# lockstep when changing the build pipeline.

# Set color output function
function Write-ColorOutput {
    param(
        [string]$Message,
        [string]$Color = 'White'
    )

    switch ($Color) {
        'Red'    { Write-Host $Message -ForegroundColor Red }
        'Green'  { Write-Host $Message -ForegroundColor Green }
        'Yellow' { Write-Host $Message -ForegroundColor Yellow }
        'Blue'   { Write-Host $Message -ForegroundColor Blue }
        default  { Write-Host $Message }
    }
}

# Detect operating system type
function Test-OperatingSystem {
    Write-ColorOutput 'Running on Windows' 'Blue'
}

<#
Function: Self-CheckScriptIntegrity
Purpose: Detect problematic quotes/encoding and parse errors in this script
Input: ScriptPath - full path of the script
Output: [bool] true if self-check passes; false otherwise
#>
function Self-CheckScriptIntegrity {
    param([string]$ScriptPath)

    Write-ColorOutput '=== Self-check: Script integrity ===' 'Blue'

    if ([string]::IsNullOrWhiteSpace($ScriptPath) -or -not (Test-Path $ScriptPath)) {
        Write-ColorOutput 'Cannot locate script path; skipping self-check' 'Yellow'
        return $true
    }

    try {
        $bytes = [IO.File]::ReadAllBytes($ScriptPath)
    }
    catch {
        Write-ColorOutput "Failed to read script; skipping self-check: $_" 'Yellow'
        return $true
    }

    $hasUtf16Le = $bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE
    $hasUtf16Be = $bytes.Length -ge 2 -and $bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF
    if ($hasUtf16Le -or $hasUtf16Be) {
        Write-ColorOutput 'UTF-16 detected; please save as UTF-8 without BOM' 'Yellow'
    }

    $text = [Text.Encoding]::UTF8.GetString($bytes)
    # Build the smart-quote test pattern from char codes — embedding
    # the literal curly quotes here would make this self-check
    # false-positive on its own source line.
    $smartQuotePattern = '[' + [char]0x201C + [char]0x201D + [char]0x2018 + [char]0x2019 + ']'
    if ($text -match $smartQuotePattern) {
        Write-ColorOutput 'Smart quotes detected (curly quotes); PowerShell may fail to parse' 'Yellow'
    }

    $errors = $null
    [System.Management.Automation.PSParser]::Tokenize($text, [ref]$errors) | Out-Null
    if ($errors -and $errors.Count -gt 0) {
        Write-ColorOutput 'Self-check found PowerShell parse errors' 'Red'
        foreach ($e in $errors) {
            Write-ColorOutput "$($e.Message) at line $($e.Token.StartLine), column $($e.Token.StartColumn)" 'Red'
        }
        return $false
    }

    Write-ColorOutput 'Self-check passed' 'Green'
    return $true
}

# Generate 16-character random string (numbers and lowercase letters)
function New-RandomString {
    param([int]$Length = 16)

    $chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    $randomString = ''

    for ($i = 0; $i -lt $Length; $i++) {
        $randomIndex = Get-Random -Maximum $chars.Length
        $randomString += $chars[$randomIndex]
    }

    return $randomString
}

<#
Function: Get-PackageInfo
Purpose: Read name/description/version from package.json
Input: ProjectRoot - project root path
Output: [hashtable] @{ Name, Description, Version }
#>
function Get-PackageInfo {
    param([string]$ProjectRoot)

    $packageJsonPath = Join-Path $ProjectRoot 'package.json'

    if (-not (Test-Path $packageJsonPath)) {
        Write-ColorOutput "package.json not found: $packageJsonPath" 'Red'
        exit 1
    }

    try {
        $packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json

        $name = $packageJson.name
        $description = if ($packageJson.description) { $packageJson.description } else { '' }
        $version = if ($packageJson.version) { $packageJson.version } else { '0.0.1' }

        Write-ColorOutput "Package name: $name" 'Blue'
        Write-ColorOutput "Version: $version" 'Blue'
        Write-ColorOutput "Description: $description" 'Blue'

        return @{
            Name        = $name
            Description = $description
            Version     = $version
        }
    }
    catch {
        Write-ColorOutput "Failed to parse package.json: $_" 'Red'
        exit 1
    }
}

<#
Function: ConvertTo-VersionCode
Purpose: Map a semver MAJOR.MINOR.PATCH string to a monotonically
         increasing integer matching buildPlugin.sh's derive_version_code
         scheme: MAJOR*10000 + MINOR*100 + PATCH
           1.0.2  -> 10002
           1.2.10 -> 10210
           2.0.0  -> 20000
Input: Version - semver string (e.g. '1.0.2')
Output: [int] derived versionCode
#>
function ConvertTo-VersionCode {
    param([string]$Version)

    $parts = $Version.Split('.')
    if ($parts.Count -lt 3) {
        Write-ColorOutput "Unrecognised version '$Version'; defaulting versionCode to 1" 'Yellow'
        return 1
    }
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]
    return ($major * 10000) + ($minor * 100) + $patch
}

<#
Function: Sync-PluginConfigVersion
Purpose: Keep PluginConfig.json's versionName/versionCode in lockstep
         with package.json. The Supernote firmware reads PluginConfig
         .json (not package.json) for the on-device plugin card and the
         installer's "update available?" check — without this rewrite,
         every artifact would ship with whatever was checked in.
Input: ProjectRoot - project root path; PackageInfo - hashtable with Version
Output: rewrites PluginConfig.json in place when it exists; otherwise no-op
#>
function Sync-PluginConfigVersion {
    param([string]$ProjectRoot, [hashtable]$PackageInfo)

    $configFile = Join-Path $ProjectRoot 'PluginConfig.json'
    if (-not (Test-Path $configFile)) { return }

    $versionCode = ConvertTo-VersionCode -Version $PackageInfo.Version

    try {
        $config = Get-Content $configFile -Raw | ConvertFrom-Json
        $configHash = @{}
        $config.PSObject.Properties | ForEach-Object { $configHash[$_.Name] = $_.Value }
        $configHash.versionName = $PackageInfo.Version
        $configHash.versionCode = "$versionCode"
        $configHash | ConvertTo-Json -Depth 10 | Set-Content $configFile -Encoding UTF8
        Write-ColorOutput "Synced PluginConfig.json: versionName=$($PackageInfo.Version), versionCode=$versionCode" 'Green'
    }
    catch {
        Write-ColorOutput "Failed to sync PluginConfig.json version fields: $_" 'Red'
        exit 1
    }
}

<#
Function: New-PluginConfig
Purpose: Create PluginConfig.json with base fields when one does not exist
Input: PluginId, PackageInfo, ProjectRoot
Output: writes ProjectRoot/PluginConfig.json
#>
function New-PluginConfig {
    param(
        [string]$PluginId,
        [hashtable]$PackageInfo,
        [string]$ProjectRoot
    )

    $configFile = Join-Path $ProjectRoot 'PluginConfig.json'
    $versionCode = ConvertTo-VersionCode -Version $PackageInfo.Version

    Write-ColorOutput 'Creating PluginConfig.json file...' 'Blue'

    $config = @{
        name        = $PackageInfo.Name
        desc        = $PackageInfo.Description
        iconPath    = ''
        versionName = $PackageInfo.Version
        versionCode = "$versionCode"
        pluginID    = $PluginId
        pluginKey   = $PackageInfo.Name
        jsMainPath  = 'index'
    }

    try {
        $config | ConvertTo-Json -Depth 10 | Set-Content $configFile -Encoding UTF8
        Write-ColorOutput "Created: $configFile" 'Green'
    }
    catch {
        Write-ColorOutput "Failed to create PluginConfig.json: $_" 'Red'
        exit 1
    }
}

<#
Function: Ensure-NodeModulesPlatform
Purpose: Guard against a node_modules tree installed on a different
         OS/arch than the host we're building on (most common when the
         project is synced between Linux/macOS and Windows). Detection
         uses esbuild as the canonical indicator: if node_modules/@esbuild
         exists but lacks the platform-specific subdir for this host,
         every tsx-driven step (Metro bundle, etc.) will fail with an
         opaque "You installed esbuild for another platform" error.
         Recovery: blow away node_modules and re-run npm install so every
         native dep — not just esbuild — comes back fresh for this host.
Input: ProjectRoot - project root path
Output: exits the script on npm install failure; otherwise no-op
#>
function Ensure-NodeModulesPlatform {
    param([string]$ProjectRoot)

    $esbuildDir = Join-Path $ProjectRoot 'node_modules\@esbuild'
    if (-not (Test-Path $esbuildDir)) { return }

    $node = Get-Command 'node' -ErrorAction SilentlyContinue
    if (-not $node) { return }

    $expected = & node -p 'process.platform + "-" + process.arch' 2>$null
    if ([string]::IsNullOrWhiteSpace($expected)) { return }
    $expected = $expected.Trim()

    $expectedDir = Join-Path $esbuildDir $expected
    if (Test-Path $expectedDir) { return }

    Write-ColorOutput "node_modules has no esbuild binary for $expected (installed on a different host); reinstalling..." 'Yellow'
    $nodeModulesDir = Join-Path $ProjectRoot 'node_modules'
    Remove-Item -Recurse -Force $nodeModulesDir
    $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm install' -Wait -PassThru -NoNewWindow -WorkingDirectory $ProjectRoot
    if ($proc.ExitCode -ne 0) {
        Write-ColorOutput 'npm install failed during platform-mismatch recovery' 'Red'
        exit 1
    }
    Write-ColorOutput "node_modules reinstalled for $expected" 'Green'
}

<#
Function: Invoke-PrepareBaseDict
Purpose: Stage + regenerate the bundled base dictionary so Metro picks
         up the latest src/core/dict/data/baseDictData.ts before bundling.
         Idempotent — fetch:dict skips the download when source files are
         already present, and build:dict re-emits in <1s.
Input: ProjectRoot - project root path
Output: exits the script on failure
#>
function Invoke-PrepareBaseDict {
    param([string]$ProjectRoot)

    Write-ColorOutput 'Preparing base dictionary...' 'Blue'
    $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run --silent prepare:dict' -Wait -PassThru -NoNewWindow -WorkingDirectory $ProjectRoot
    if ($proc.ExitCode -ne 0) {
        Write-ColorOutput 'Base dictionary preparation failed' 'Red'
        exit 1
    }
}

<#
Function: Update-PluginConfigPackages
Purpose: Ensure build/generated PluginConfig.json carries the discovered
         reactPackages array.
#>
function Update-PluginConfigPackages {
    param(
        [string]$ProjectRoot,
        [array]$FoundPackages,
        [string]$BuildGeneratedDir
    )

    $configFile = Join-Path $BuildGeneratedDir 'PluginConfig.json'

    if ($FoundPackages.Count -eq 0) {
        Write-ColorOutput 'No ReactPackage implementations found, skipping PluginConfig.json update' 'Yellow'
        return
    }

    Write-ColorOutput 'Updating reactPackages in build/generated/PluginConfig.json...' 'Blue'

    try {
        if (-not (Test-Path $configFile)) {
            $rootConfigFile = Join-Path $ProjectRoot 'PluginConfig.json'
            if (Test-Path $rootConfigFile) {
                Copy-Item $rootConfigFile $configFile -Force
                Write-ColorOutput 'Copied PluginConfig.json from project root to build/generated' 'Blue'
            }
            else {
                Write-ColorOutput 'PluginConfig.json not found in either location' 'Red'
                return
            }
        }

        $config = Get-Content $configFile -Raw | ConvertFrom-Json
        $configHash = @{}
        $config.PSObject.Properties | ForEach-Object { $configHash[$_.Name] = $_.Value }

        if ($FoundPackages.Count -eq 1) {
            $configHash.reactPackages = @($FoundPackages)
        } else {
            $configHash.reactPackages = $FoundPackages
        }

        $configHash | ConvertTo-Json -Depth 10 | Set-Content $configFile -Encoding UTF8
        Write-ColorOutput 'reactPackages written' 'Green'
    }
    catch {
        Write-ColorOutput "Failed to update PluginConfig.json: $_" 'Red'
    }
}

<#
Function: Find-PackagesInDirectory
Purpose: Scan .java/.kt sources and append ReactPackage-like classes to
         the FoundPackages collector.
#>
function Find-PackagesInDirectory {
    param(
        [string]$SearchDir,
        [string]$ResultFile,
        [ref]$FoundPackages
    )

    if (-not (Test-Path $SearchDir)) { return }

    $javaFiles = Get-ChildItem -Path $SearchDir -Recurse -Filter '*.java' -File -ErrorAction SilentlyContinue
    $ktFiles   = Get-ChildItem -Path $SearchDir -Recurse -Filter '*.kt'   -File -ErrorAction SilentlyContinue
    $sourceFiles = @()
    if ($javaFiles) { $sourceFiles += $javaFiles }
    if ($ktFiles)   { $sourceFiles += $ktFiles }

    foreach ($file in $sourceFiles) {
        try {
            $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
            $isKotlin = ([System.IO.Path]::GetExtension($file.FullName)).ToLower() -eq '.kt'

            $matchesClass = $false
            $className = $null
            $packageName = $null

            if ($isKotlin) {
                if ($content -match 'class\s+([A-Za-z0-9_]+)\s*:\s*[^\{\n]*\b(ReactPackage|TurboReactPackage|BaseReactPackage|ViewManagerOnDemandReactPackage)\b') {
                    $matchesClass = $true
                    $className = $matches[1].Trim()
                }
                if ($content -match 'package\s+([^\s;]+)') {
                    $packageName = $matches[1].Trim()
                }
            } else {
                if ($content -match '(implements\s+(ReactPackage|ViewManagerOnDemandReactPackage)|extends\s+(ReactPackage|TurboReactPackage|BaseReactPackage))') {
                    $matchesClass = $true
                }
                if ($content -match 'class\s+([A-Za-z0-9_]+)') {
                    $className = $matches[1].Trim()
                }
                if ($content -match 'package\s+([^;]+);') {
                    $packageName = $matches[1].Trim()
                }
            }

            if ($matchesClass -and $packageName -and $className) {
                $fullClassName = "$packageName.$className"
                Write-ColorOutput "  - Found ReactPackage implementation: $fullClassName" 'Green'
                Add-Content $ResultFile "  - $fullClassName"
                $FoundPackages.Value += $fullClassName
            }
        }
        catch { continue }
    }
}

<#
Function: Is-IgnoredModuleName
Purpose: Determine whether a node_modules module should be ignored
         (RN core libs and sn-plugin-lib).
#>
function Is-IgnoredModuleName {
    param([string]$moduleName)

    if (-not $moduleName) { return $false }
    $lower = $moduleName.ToLower()

    if ($lower -eq 'react-native')   { return $true }
    if ($lower -eq 'react')           { return $true }
    if ($lower -eq 'sn-plugin-lib')   { return $true }
    if ($lower -like '@react-native*')    { return $true }
    if ($lower -like '@react-navigation*') { return $true }
    return $false
}

<#
Function: Find-ManualReactPackagesFromApplication
Purpose: Parse Application classes to extract ReactPackage classes added
         via getPackages/add (manual registration).
#>
function Find-ManualReactPackagesFromApplication {
    param([string]$ProjectRoot)

    $dirsToScan = @()
    $dirsToScan += (Join-Path $ProjectRoot 'android\app\src\main\java')
    $dirsToScan += (Join-Path $ProjectRoot 'android\src\main\java')
    $dirsToScan += (Join-Path $ProjectRoot 'app\android\src\main\java')

    $found = @()

    foreach ($dir in $dirsToScan) {
        if (-not (Test-Path $dir)) { continue }
        $files = @()
        $files += (Get-ChildItem -Path $dir -Recurse -Filter '*.kt'   -File -ErrorAction SilentlyContinue)
        $files += (Get-ChildItem -Path $dir -Recurse -Filter '*.java' -File -ErrorAction SilentlyContinue)

        foreach ($f in $files) {
            try {
                $text = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
                $text = ($text -replace '(?m)^\s*//.*$', '')
                $text = ($text -replace '(?s)/\*.*?\*/', '')
                $packageName = $null
                if ($text -match '(?m)^\s*package\s+([^\s;]+)') {
                    $packageName = $matches[1].Trim()
                }

                $imports = @{}
                foreach ($imp in ($text -split "`r?`n")) {
                    if ($imp -match '^\s*import\s+([^\s;]+)') {
                        $fq = $matches[1].Trim()
                        $short = $fq.Split('.')[-1]
                        $imports[$short] = $fq
                    }
                }

                $resolveFqcn = {
                    param([string]$name)
                    if ($name -like '*.*') { return $name }
                    if ($imports.ContainsKey($name)) { return $imports[$name] }
                    if ($packageName) { return "$packageName.$name" }
                    return $name
                }

                $matchesKotlin = [System.Text.RegularExpressions.Regex]::Matches($text, '\badd\(\s*([A-Za-z0-9_\.]+)\s*\(')
                foreach ($m in $matchesKotlin) {
                    $name = $m.Groups[1].Value
                    $fqcn = (& $resolveFqcn $name)
                    if ($fqcn -match 'Package$') { $found += $fqcn }
                }

                $matchesJava = [System.Text.RegularExpressions.Regex]::Matches($text, '\b(?:packages\.)?add\(\s*new\s+([A-Za-z0-9_\.]+)\s*\(')
                foreach ($m in $matchesJava) {
                    $name = $m.Groups[1].Value
                    $fqcn = (& $resolveFqcn $name)
                    if ($fqcn -match 'Package$') { $found += $fqcn }
                }
            } catch { continue }
        }
    }

    $found = $found | Sort-Object -Unique
    Write-ColorOutput "Manually added packages in Application: $($found.Count)" 'Blue'
    foreach ($pkg in $found) { Write-ColorOutput "  - $pkg" 'Green' }
    return $found
}

<#
Function: Scan-NodeModulesNativeCode
Purpose: Return third-party node_modules dependencies that ship Java/Kotlin
         sources (used as a signal that we need to run a Gradle build).
#>
function Scan-NodeModulesNativeCode {
    param([string]$ProjectRoot)

    $nodeModulesDir = Join-Path $ProjectRoot 'node_modules'
    $modsWithNative = @()
    if (-not (Test-Path $nodeModulesDir)) { return $modsWithNative }

    $topDirs = Get-ChildItem -Path $nodeModulesDir -Directory -ErrorAction SilentlyContinue

    foreach ($dir in $topDirs) {
        if ($dir.Name -like '@*') {
            $scoped = Get-ChildItem -Path $dir.FullName -Directory -ErrorAction SilentlyContinue
            foreach ($sub in $scoped) {
                $moduleName = "$($dir.Name)/$($sub.Name)"
                if (Is-IgnoredModuleName -moduleName $moduleName) { continue }
                $moduleRoot = $sub.FullName
                $dirsToScan = @(
                    (Join-Path $moduleRoot 'android'),
                    (Join-Path $moduleRoot 'platforms\android'),
                    (Join-Path $moduleRoot 'platforms\android-native')
                )
                $hasNative = $false
                foreach ($scanDir in $dirsToScan) {
                    if (Test-Path $scanDir) {
                        $javaFiles = Get-ChildItem -Path $scanDir -Recurse -Filter '*.java' -File -ErrorAction SilentlyContinue
                        $ktFiles   = Get-ChildItem -Path $scanDir -Recurse -Filter '*.kt'   -File -ErrorAction SilentlyContinue
                        if (($javaFiles -and $javaFiles.Count -gt 0) -or ($ktFiles -and $ktFiles.Count -gt 0)) { $hasNative = $true; break }
                    }
                }
                if ($hasNative) {
                    $modsWithNative += $moduleName
                    Write-ColorOutput "Third-party module contains Android sources: $moduleName" 'Yellow'
                }
            }
        } else {
            $moduleName = $dir.Name
            if (Is-IgnoredModuleName -moduleName $moduleName) { continue }
            $moduleRoot = $dir.FullName
            $dirsToScan = @(
                (Join-Path $moduleRoot 'android'),
                (Join-Path $moduleRoot 'platforms\android'),
                (Join-Path $moduleRoot 'platforms\android-native')
            )
            $hasNative = $false
            foreach ($scanDir in $dirsToScan) {
                if (Test-Path $scanDir) {
                    $javaFiles = Get-ChildItem -Path $scanDir -Recurse -Filter '*.java' -File -ErrorAction SilentlyContinue
                    $ktFiles   = Get-ChildItem -Path $scanDir -Recurse -Filter '*.kt'   -File -ErrorAction SilentlyContinue
                    if (($javaFiles -and $javaFiles.Count -gt 0) -or ($ktFiles -and $ktFiles.Count -gt 0)) { $hasNative = $true; break }
                }
            }
            if ($hasNative) {
                $modsWithNative += $moduleName
                Write-ColorOutput "Third-party module contains Android sources: $moduleName" 'Yellow'
            }
        }
    }

    $modsWithNative = $modsWithNative | Sort-Object -Unique
    Write-ColorOutput "Third-party dependencies with Android sources: $($modsWithNative.Count)" 'Blue'
    return $modsWithNative
}

<#
Function: Get-ReactPackagesFromAutolinkingSource
Purpose: Parse autolinking-generated PackageList.java to extract
         ReactPackage classes, then filter exclusions.
#>
function Get-ReactPackagesFromAutolinkingSource {
    param([string]$ProjectRoot, [string[]]$Exclude)

    $srcFile = Join-Path $ProjectRoot 'android\app\build\generated\autolinking\src\main\java\com\facebook\react\PackageList.java'
    if (-not (Test-Path $srcFile)) {
        Write-ColorOutput "Autolinking PackageList.java not found: $srcFile" 'Yellow'
        return @()
    }

    try {
        $text = Get-Content $srcFile -Raw
        $imports = @{}
        foreach ($line in ($text -split "`r?`n")) {
            if ($line -match '^\s*import\s+([^\s;]+)') {
                $fq = $matches[1].Trim()
                $short = $fq.Split('.')[-1]
                $imports[$short] = $fq
            }
        }
        $matchesNew = [System.Text.RegularExpressions.Regex]::Matches($text, 'new\s+([A-Za-z0-9_\.]+)\s*\(')
        $pkgs = @()
        foreach ($m in $matchesNew) {
            $name = $m.Groups[1].Value
            $fqcn = if ($name -like '*.*') { $name } elseif ($imports.ContainsKey($name)) { $imports[$name] } else { $name }
            if ($fqcn -match 'Package$') { $pkgs += $fqcn }
        }
        $pkgs = $pkgs | Sort-Object -Unique
        Write-ColorOutput "Packages extracted from autolinking source: $($pkgs.Count)" 'Blue'
        if ($Exclude -and $Exclude.Count -gt 0) {
            $pkgs = $pkgs | Where-Object { $Exclude -notcontains $_ }
        }
        Write-ColorOutput "Filtered package count: $($pkgs.Count)" 'Blue'
        return $pkgs
    } catch {
        Write-ColorOutput "Failed to parse Autolinking PackageList.java: $_" 'Red'
        return @()
    }
}

<#
Function: Build-AndroidApk
Purpose: Build the custom debug APK via gradle.
#>
function Build-AndroidApk {
    param([string]$ProjectRoot)

    $androidDir = Join-Path $ProjectRoot 'android'
    if (-not (Test-Path $androidDir)) {
        Write-ColorOutput 'android directory not found' 'Red'
        return $false
    }

    Write-ColorOutput 'Running gradle task: buildCustomApkDebug...' 'Blue'

    $currentDir = Get-Location
    try {
        Set-Location $androidDir

        $gradlewPath = Join-Path $androidDir 'gradlew.bat'
        if (Test-Path $gradlewPath) {
            $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'gradlew.bat', 'buildCustomApkDebug' -Wait -PassThru -NoNewWindow
        }
        elseif (Get-Command 'gradle' -ErrorAction SilentlyContinue) {
            $proc = Start-Process -FilePath 'gradle' -ArgumentList 'buildCustomApkDebug' -Wait -PassThru -NoNewWindow
        }
        else {
            Write-ColorOutput 'gradle/gradlew not found' 'Red'
            return $false
        }

        if ($proc.ExitCode -eq 0) {
            Write-ColorOutput 'APK build succeeded' 'Green'
            return $true
        } else {
            Write-ColorOutput 'APK build failed' 'Red'
            return $false
        }
    }
    finally {
        Set-Location $currentDir
    }
}

<#
Function: Copy-ApkAndUpdateConfig
Purpose: Copy the generated APK as app.npk into build/generated and set
         nativeCodePackage in PluginConfig.json.
#>
function Copy-ApkAndUpdateConfig {
    param([string]$ProjectRoot, [string]$BuildGeneratedDir, [string]$BuildGeneratedConfigFile)

    $apkSearchPath = Join-Path $ProjectRoot 'android\app\build\outputs\apk'

    $customApkFiles = Get-ChildItem -Path $apkSearchPath -Recurse -Filter '*custom*.apk' -ErrorAction SilentlyContinue
    $apkPath = $null
    if ($customApkFiles) {
        $apkPath = $customApkFiles[0].FullName
    } else {
        $apkFiles = Get-ChildItem -Path $apkSearchPath -Recurse -Filter '*.apk' -ErrorAction SilentlyContinue
        if ($apkFiles) { $apkPath = $apkFiles[0].FullName }
    }

    if (-not $apkPath -or -not (Test-Path $apkPath)) {
        Write-ColorOutput 'Generated APK file not found' 'Red'
        return $false
    }

    $newApkFileName = 'app.npk'
    $targetApkPath = Join-Path $BuildGeneratedDir $newApkFileName

    try {
        Copy-Item $apkPath $targetApkPath -Force
        Write-ColorOutput "APK copied to: $targetApkPath" 'Green'

        $config = Get-Content $BuildGeneratedConfigFile -Raw | ConvertFrom-Json
        $configHash = @{}
        $config.PSObject.Properties | ForEach-Object { $configHash[$_.Name] = $_.Value }
        $configHash.nativeCodePackage = "/$newApkFileName"
        $configHash | ConvertTo-Json -Depth 10 | Set-Content $BuildGeneratedConfigFile -Encoding UTF8
        Write-ColorOutput "nativeCodePackage updated to: /$newApkFileName" 'Green'
        return $true
    }
    catch {
        Write-ColorOutput "Failed to copy APK or update configuration: $_" 'Red'
        return $false
    }
}

<#
Function: Build-ReactNativeBundle
Purpose: Run `npx react-native bundle` to emit the JS bundle into
         build/generated.
#>
function Build-ReactNativeBundle {
    param([string]$ProjectRoot, [string]$ProjectName, [string]$OutputDir)

    Write-ColorOutput 'Starting React Native bundling...' 'Blue'
    $bundleOutput = Join-Path $OutputDir "$ProjectName.bundle"
    $bundleCommand = "npx react-native bundle --entry-file index.js --bundle-output `"$bundleOutput`" --platform android --assets-dest `"$OutputDir`" --dev false"
    Write-ColorOutput "Executing command: $bundleCommand" 'Yellow'

    try {
        $proc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $bundleCommand -Wait -PassThru -NoNewWindow -WorkingDirectory $ProjectRoot
        if ($proc.ExitCode -eq 0) {
            Write-ColorOutput "Bundle generated: $bundleOutput" 'Green'
            return $true
        } else {
            Write-ColorOutput "React Native bundling failed, exit code: $($proc.ExitCode)" 'Red'
            return $false
        }
    }
    catch {
        Write-ColorOutput "Error executing React Native bundle command: $_" 'Red'
        return $false
    }
}

<#
Function: Copy-IconAndUpdatePath
Purpose: Copy icon file into build/generated and set iconPath.
#>
function Copy-IconAndUpdatePath {
    param([string]$ProjectRoot, [string]$BuildGeneratedDir, [string]$BuildGeneratedConfigFile)

    try {
        $rootConfigFile = Join-Path $ProjectRoot 'PluginConfig.json'
        if (-not (Test-Path $rootConfigFile)) {
            Write-ColorOutput 'Root PluginConfig.json not found' 'Yellow'
            return
        }
        $rootConfig = Get-Content $rootConfigFile -Raw | ConvertFrom-Json

        if (-not $rootConfig.iconPath -or $rootConfig.iconPath -eq '') {
            Write-ColorOutput 'iconPath not set or empty' 'Yellow'
            return
        }

        $iconPath = $rootConfig.iconPath
        $sourceIconPath = if ([System.IO.Path]::IsPathRooted($iconPath)) { $iconPath } else { Join-Path $ProjectRoot $iconPath }

        if (-not (Test-Path $sourceIconPath)) {
            Write-ColorOutput "Icon file not found: $sourceIconPath" 'Yellow'
            return
        }

        $iconFileName = Split-Path $sourceIconPath -Leaf
        $targetIconPath = Join-Path $BuildGeneratedDir $iconFileName
        Copy-Item $sourceIconPath $targetIconPath -Force
        Write-ColorOutput "Icon copied to: $targetIconPath" 'Green'

        $config = Get-Content $BuildGeneratedConfigFile -Raw | ConvertFrom-Json
        $configHash = @{}
        $config.PSObject.Properties | ForEach-Object { $configHash[$_.Name] = $_.Value }
        $configHash.iconPath = "/$iconFileName"
        $configHash | ConvertTo-Json -Depth 10 | Set-Content $BuildGeneratedConfigFile -Encoding UTF8
        Write-ColorOutput "iconPath updated to: /$iconFileName" 'Green'
    }
    catch {
        Write-ColorOutput "Error copying icon file: $_" 'Red'
    }
}

<#
Function: New-ZipPackage
Purpose: Compress build/generated into a zip via Compress-Archive.
#>
function New-ZipPackage {
    param([string]$SourceDir, [string]$DestinationPath)

    Write-ColorOutput "Packaging directory: $SourceDir" 'Blue'

    if (-not (Test-Path $SourceDir)) {
        Write-ColorOutput "Source directory does not exist: $SourceDir" 'Red'
        return $false
    }

    $items = Get-ChildItem -Path $SourceDir -Recurse
    if ($items.Count -eq 0) {
        Write-ColorOutput 'Source directory is empty' 'Yellow'
        return $false
    }

    if (Test-Path $DestinationPath) {
        Remove-Item $DestinationPath -Force
    }

    try {
        Compress-Archive -Path "$SourceDir\*" -DestinationPath $DestinationPath -Force
        Write-ColorOutput "Zip created: $DestinationPath" 'Green'
        return $true
    }
    catch {
        Write-ColorOutput "Failed to create zip: $_" 'Red'
        return $false
    }
}

<#
Function: Rename-ToSnplgFile
Purpose: Move the zip artifact into a project-named .snplg.
#>
function Rename-ToSnplgFile {
    param([string]$ZipFilePath, [string]$ProjectName, [string]$OutputDir)

    if (-not (Test-Path $ZipFilePath)) {
        Write-ColorOutput "Zip file does not exist: $ZipFilePath" 'Red'
        return $null
    }

    try {
        $snplgFilePath = Join-Path $OutputDir "$ProjectName.snplg"
        if (Test-Path $snplgFilePath) {
            Remove-Item $snplgFilePath -Force
        }
        Move-Item $ZipFilePath $snplgFilePath -Force
        Write-ColorOutput "Plugin package created: $snplgFilePath" 'Green'
        return $snplgFilePath
    }
    catch {
        Write-ColorOutput "Failed to rename file: $_" 'Red'
        return $null
    }
}

# Main function
function Main {
    Test-OperatingSystem

    $selfCheckOk = Self-CheckScriptIntegrity -ScriptPath $PSCommandPath
    if (-not $selfCheckOk) { return }

    $projectRoot = (Get-Location).Path
    Write-ColorOutput "Project root directory: $projectRoot" 'Green'

    $packageInfo = Get-PackageInfo -ProjectRoot $projectRoot

    # Pull PluginConfig.json's versionName/versionCode forward from
    # package.json before anything downstream touches the config.
    Sync-PluginConfigVersion -ProjectRoot $projectRoot -PackageInfo $packageInfo

    $projectName = $packageInfo.Name
    $buildGeneratedDir = Join-Path $projectRoot 'build\generated'
    if (-not (Test-Path $buildGeneratedDir)) {
        New-Item -ItemType Directory -Path $buildGeneratedDir -Force | Out-Null
        Write-ColorOutput "Created build/generated directory: $buildGeneratedDir" 'Green'
    }

    # Guard against node_modules carrying native binaries for a different
    # host (common when syncing the tree between hosts). Runs before any
    # npm step so the RN bundler never hits an opaque platform-mismatch
    # stacktrace.
    Ensure-NodeModulesPlatform -ProjectRoot $projectRoot

    # Stage + regenerate the bundled base dictionary so Metro picks up the
    # latest src/core/dict/data/baseDictData.ts before bundling.
    Invoke-PrepareBaseDict -ProjectRoot $projectRoot

    $bundleSuccess = Build-ReactNativeBundle -ProjectRoot $projectRoot -ProjectName $projectName -OutputDir $buildGeneratedDir
    if (-not $bundleSuccess) {
        Write-ColorOutput 'React Native bundling failed, script terminated' 'Red'
        return
    }

    $rootConfigFile = Join-Path $projectRoot 'PluginConfig.json'
    if (-not (Test-Path $rootConfigFile)) {
        $pluginId = New-RandomString
        Write-ColorOutput "Generated pluginID: $pluginId" 'Blue'
        New-PluginConfig -PluginId $pluginId -PackageInfo $packageInfo -ProjectRoot $projectRoot
    }

    $buildGeneratedConfigFile = Join-Path $buildGeneratedDir 'PluginConfig.json'
    Copy-Item $rootConfigFile $buildGeneratedConfigFile -Force
    Copy-IconAndUpdatePath -ProjectRoot $projectRoot -BuildGeneratedDir $buildGeneratedDir -BuildGeneratedConfigFile $buildGeneratedConfigFile

    $projectReactPkgs = Find-ManualReactPackagesFromApplication -ProjectRoot $projectRoot
    $thirdPartyNativeMods = Scan-NodeModulesNativeCode -ProjectRoot $projectRoot

    $shouldBuildNative = ($projectReactPkgs.Count -gt 0) -or ($thirdPartyNativeMods.Count -gt 0)
    if ($shouldBuildNative) {
        Write-ColorOutput "Build conditions met: project packages=$($projectReactPkgs.Count), third-party native modules=$($thirdPartyNativeMods.Count)" 'Green'

        $excludePkgs = @(
            'com.facebook.react.shell.MainReactPackage',
            'com.ratta.supernote.note.plugincore.PluginPackage',
            'com.ratta.supernote.pluginlib.PluginPackage'
        )
        $pkgFromAutolinking = Get-ReactPackagesFromAutolinkingSource -ProjectRoot $projectRoot -Exclude $excludePkgs

        $allPkgs = @()
        $allPkgs += $projectReactPkgs
        $allPkgs += $pkgFromAutolinking
        $dedupPkgs = $allPkgs | Sort-Object -Unique

        Update-PluginConfigPackages -ProjectRoot $projectRoot -FoundPackages $dedupPkgs -BuildGeneratedDir $buildGeneratedDir

        if (Build-AndroidApk -ProjectRoot $projectRoot) {
            $apkCopied = Copy-ApkAndUpdateConfig -ProjectRoot $projectRoot -BuildGeneratedDir $buildGeneratedDir -BuildGeneratedConfigFile $buildGeneratedConfigFile
            if (-not $apkCopied) { Write-ColorOutput 'Failed to copy APK or update configuration' 'Red' }
        } else {
            Write-ColorOutput 'Gradle build failed, skipping APK copy and configuration update' 'Red'
        }
    }
    else {
        Write-ColorOutput 'Build conditions not met; skipping native build and reactPackages update' 'Yellow'
    }

    $buildOutputsDir = Join-Path $projectRoot 'build\outputs'
    if (-not (Test-Path $buildOutputsDir)) {
        New-Item -ItemType Directory -Path $buildOutputsDir -Force | Out-Null
        Write-ColorOutput "Created build/outputs directory: $buildOutputsDir" 'Green'
    }

    $tempZipPath = Join-Path $buildOutputsDir 'temp_package.zip'
    if (New-ZipPackage -SourceDir $buildGeneratedDir -DestinationPath $tempZipPath) {
        $null = Rename-ToSnplgFile -ZipFilePath $tempZipPath -ProjectName $projectName -OutputDir $buildOutputsDir
        $finalSnplgPath = Join-Path $buildOutputsDir "$projectName.snplg"
        if (Test-Path $finalSnplgPath) {
            $fileInfo = Get-Item -LiteralPath $finalSnplgPath
            $fileSizeMB = [math]::Round($fileInfo.Length / 1MB, 2)
            Write-ColorOutput "File size: $fileSizeMB MB" 'Blue'
        }
    }

    Write-ColorOutput 'Build process completed' 'Blue'
}

# Execute main function
Main
