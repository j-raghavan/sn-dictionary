#!/bin/bash
set -euo pipefail

# =========================================================
# Function: write_color_output
# Purpose: Print colored messages to the terminal
# Params: $1 message; $2 color("Red"/"Green"/"Yellow"/"Blue")
# Returns: none
# =========================================================
write_color_output() {
    local message="${1:-}"
    local color="${2:-}"
    case "$color" in
        "Red")    printf "\033[31m%s\033[0m\n" "$message" >&2 ;;
        "Green")  printf "\033[32m%s\033[0m\n" "$message" >&2 ;;
        "Yellow") printf "\033[33m%s\033[0m\n" "$message" >&2 ;;
        "Blue")   printf "\033[34m%s\033[0m\n" "$message" >&2 ;;
        *)         printf "%s\n" "$message" >&2 ;;
    esac
}

# =========================================================
# Function: test_operating_system
# Purpose: Print current operating system information
# Params: none
# Returns: none
# =========================================================
test_operating_system() {
    local os_name
    os_name="$(uname -s || echo "Windows")"
    write_color_output "Running on: ${os_name}" "Blue"
}

# =========================================================
# Function: new_random_string
# Purpose: Generate a random string with digits and lowercase letters
# Params: $1 length (default 16)
# Returns: print the random string
# =========================================================
new_random_string() {
    local length="${1:-16}"
    LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c "$length"
    echo
}

# =========================================================
# Function: get_package_info
# Purpose: Read name/description/version from package.json
# Params: $1 project root
# Returns: sets PACKAGE_NAME, PACKAGE_DESCRIPTION, PACKAGE_VERSION
# =========================================================
get_package_info() {
    local project_root="$1"
    local package_json="$project_root/package.json"
    if [[ ! -f "$package_json" ]]; then
        write_color_output "package.json not found: $package_json" "Red"
        exit 1
    fi

    local name desc version
    if command -v jq >/dev/null 2>&1; then
        name="$(jq -r '.name' "$package_json")"
        desc="$(jq -r '.description // ""' "$package_json")"
        version="$(jq -r '.version // "0.0.1"' "$package_json")"
    elif command -v python3 >/dev/null 2>&1; then
        name="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf-8-sig'))['name'])" "$package_json")"
        desc="$(python3 -c "import json,sys;d=json.load(open(sys.argv[1],encoding='utf-8-sig'));print(d.get('description',''))" "$package_json")"
        version="$(python3 -c "import json,sys;d=json.load(open(sys.argv[1],encoding='utf-8-sig'));print(d.get('version','0.0.1'))" "$package_json")"
    else
        write_color_output "Please install jq or python3 to parse JSON" "Red"
        exit 1
    fi

    write_color_output "Package name: $name" "Blue"
    write_color_output "Version: $version" "Blue"
    write_color_output "Description: $desc" "Blue"

    PACKAGE_NAME="$name"
    PACKAGE_DESCRIPTION="$desc"
    PACKAGE_VERSION="$version"
}

# =========================================================
# Function: derive_version_code
# Purpose: Map a semver MAJOR.MINOR.PATCH string to a monotonically
#          increasing integer, so Supernote's PluginInstallManager can
#          tell whether a build is "newer" than one already installed
#          (it compares versionCode numerically).
#          Scheme: MAJOR*10000 + MINOR*100 + PATCH
#            1.0.2  -> 10002
#            1.2.10 -> 10210
#            2.0.0  -> 20000
# Params: $1 version string (e.g. "1.0.2")
# Returns: prints the derived integer versionCode
# =========================================================
derive_version_code() {
    local version="$1"
    local major minor patch
    IFS='.' read -r major minor patch <<< "$version"
    echo $(( major * 10000 + minor * 100 + patch ))
}

# =========================================================
# Function: sync_plugin_config_version
# Purpose: Keep PluginConfig.json's versionName/versionCode in lockstep
#          with package.json. The Supernote firmware reads PluginConfig
#          .json (not package.json) for the on-device plugin card and
#          the installer's "update available?" check — if we don't
#          rewrite these two fields on every build, every APK ships
#          with whatever was checked in (often the scaffold's 0.1.0).
#
#          Runs AFTER get_package_info, BEFORE the "regenerate or skip"
#          decision below. If PluginConfig.json is absent we skip —
#          new_plugin_config will create a fresh one with the right
#          version straight from PACKAGE_VERSION.
# Params: $1 project root
# Returns: rewrites $project_root/PluginConfig.json in place
# =========================================================
sync_plugin_config_version() {
    local project_root="$1"
    local config_file="$project_root/PluginConfig.json"
    if [[ ! -f "$config_file" ]]; then
        return 0
    fi

    local version_code
    version_code="$(derive_version_code "$PACKAGE_VERSION")"

    if command -v jq >/dev/null 2>&1; then
        local tmp
        tmp="$(mktemp)"
        jq --arg v "$PACKAGE_VERSION" --arg c "$version_code" \
            '.versionName = $v | .versionCode = $c' \
            "$config_file" > "$tmp" && mv "$tmp" "$config_file"
    elif command -v python3 >/dev/null 2>&1; then
        python3 - "$config_file" "$PACKAGE_VERSION" "$version_code" <<'PY'
import json, sys
path, version, code = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, encoding='utf-8-sig') as f:
    cfg = json.load(f)
cfg['versionName'] = version
cfg['versionCode'] = code
with open(path, 'w', encoding='utf-8') as f:
    json.dump(cfg, f, indent=2, ensure_ascii=False)
    f.write('\n')
PY
    else
        write_color_output "Please install jq or python3 to sync PluginConfig.json" "Red"
        exit 1
    fi

    write_color_output "Synced PluginConfig.json: versionName=$PACKAGE_VERSION, versionCode=$version_code" "Green"
}

# =========================================================
# Function: new_plugin_config
# Purpose: Create PluginConfig.json with base fields
# Params: $1 plugin_id; $2 project root
# Returns: writes ProjectRoot/PluginConfig.json
# =========================================================
new_plugin_config() {
    local plugin_id="$1"
    local project_root="$2"
    local config_file="$project_root/PluginConfig.json"

    local version_code
    version_code="$(derive_version_code "$PACKAGE_VERSION")"

    write_color_output "Creating PluginConfig.json..." "Blue"
    cat > "$config_file" <<EOF
{
  "name": "$PACKAGE_NAME",
  "desc": "$PACKAGE_DESCRIPTION",
  "iconPath": "",
  "versionName": "$PACKAGE_VERSION",
  "versionCode": "$version_code",
  "pluginID": "$plugin_id",
  "pluginKey": "$PACKAGE_NAME",
  "jsMainPath": "index"
}
EOF
    write_color_output "Created: $config_file" "Green"
}

# =========================================================
# Function: is_ignored_module_name
# Purpose: Filter RN official libraries and specific modules
# Params: $1 module name (with or without scope)
# Returns: 0 to ignore; 1 otherwise
# =========================================================
is_ignored_module_name() {
    local module_name="$1"
    local lower
    lower="$(printf "%s" "$module_name" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
    case "$lower" in
        react-native|react|sn-plugin-lib) return 0 ;;
    esac
    [[ "$lower" == @react-native* ]] && return 0
    [[ "$lower" == @react-navigation* ]] && return 0
    return 1
}

# =========================================================
# Function: find_packages_in_directory
# Purpose: Scan .java/.kt sources and collect ReactPackage-like classes
# Params: $1 search dir; $2 result file path
# Returns: append to result file and update FOUND_PACKAGES (| separated)
# =========================================================
find_packages_in_directory() {
    local search_dir="$1"
    local result_file="$2"
    [[ ! -d "$search_dir" ]] && return

    local f
    while IFS= read -r -d '' f; do
        local content ext package_name class_name matches_class
        content="$(cat "$f")"
        ext="${f##*.}"
        package_name="$(printf "%s" "$content" | sed -E -n 's/^[[:space:]]*package[[:space:]]+//p' | head -n1 | tr -d ';' | tr -d '\r')"
        class_name="$(printf "%s" "$content" | sed -E -n 's/.*class[[:space:]]+([A-Za-z0-9_]+).*/\1/p' | head -n1 | tr -d '\r')"
        matches_class=0

        if [[ "$ext" == "kt" ]]; then
            if printf "%s" "$content" | grep -Eiq 'class[[:space:]]+[A-Za-z0-9_]+[[:space:]]*:[^{\n]*\b(ReactPackage|TurboReactPackage|BaseReactPackage|ViewManagerOnDemandReactPackage)\b'; then
                matches_class=1
            fi
        else
            if printf "%s" "$content" | grep -Eiq '(implements[[:space:]]+(ReactPackage|ViewManagerOnDemandReactPackage)|extends[[:space:]]+(ReactPackage|TurboReactPackage|BaseReactPackage))'; then
                matches_class=1
            fi
        fi

        if [[ "$matches_class" -eq 1 && -n "$package_name" && -n "$class_name" ]]; then
            local full_class_name="$package_name.$class_name"
            write_color_output "  - Found ReactPackage implementation: $full_class_name" "Green"
            echo "  - $full_class_name" >> "$result_file"
            if [[ -z "${FOUND_PACKAGES:-}" ]]; then
                FOUND_PACKAGES="$full_class_name"
            else
                FOUND_PACKAGES="$FOUND_PACKAGES|$full_class_name"
            fi
        fi
    done < <(find "$search_dir" -type f \( -name '*.java' -o -name '*.kt' \) -print0 2>/dev/null)
}

# =========================================================
# Function: find_project_react_packages
# Purpose: Scan android and app/android to collect packages
# Params: $1 project root
# Returns: print deduplicated package names (newline separated)
# =========================================================
find_project_react_packages() {
    local project_root="$1"
    local result_file="$project_root/android_project_react_packages.txt"
    echo "ReactPackage implementations in project:" > "$result_file"
    FOUND_PACKAGES=""

    local android_dir="$project_root/android"
    [[ -d "$android_dir" ]] && find_packages_in_directory "$android_dir" "$result_file"
    local app_android_dir="$project_root/app/android"
    [[ -d "$app_android_dir" ]] && find_packages_in_directory "$app_android_dir" "$result_file"

    if [[ -n "$FOUND_PACKAGES" ]]; then
        echo "$FOUND_PACKAGES" | tr '|' '\n' | sort -u
    fi
}

# =========================================================
# Function: scan_node_modules_native_code
# Purpose: Return third-party dependencies containing .java/.kt sources
# Params: $1 project root
# Returns: print module names (newline separated)
# =========================================================
scan_node_modules_native_code() {
    local project_root="$1"
    local node_modules_dir="$project_root/node_modules"
    [[ ! -d "$node_modules_dir" ]] && return

    local modules=()
    for top in "$node_modules_dir"/*; do
        [[ ! -d "$top" ]] && continue
        if [[ "$(basename "$top")" == @* ]]; then
            for sub in "$top"/*; do
                [[ ! -d "$sub" ]] && continue
                local module_name="$(basename "$top")/$(basename "$sub")"
                is_ignored_module_name "$module_name" && continue
                local root="$sub" has_native=0
                for scan_dir in "$root/android" "$root/platforms/android" "$root/platforms/android-native"; do
                    if [[ -d "$scan_dir" ]] && find "$scan_dir" -type f \( -name '*.java' -o -name '*.kt' \) -quit 2>/dev/null; then
                        has_native=1; break
                    fi
                done
                if [[ "$has_native" -eq 1 ]]; then
                    modules+=("$module_name")
                    write_color_output "Third-party module contains Android sources: $module_name" "Yellow"
                fi
            done
        else
            local module_name="$(basename "$top")"
            is_ignored_module_name "$module_name" && continue
            local root="$top" has_native=0
            for scan_dir in "$root/android" "$root/platforms/android" "$root/platforms/android-native"; do
                if [[ -d "$scan_dir" ]] && find "$scan_dir" -type f \( -name '*.java' -o -name '*.kt' \) -quit 2>/dev/null; then
                    has_native=1; break
                fi
            done
            if [[ "$has_native" -eq 1 ]]; then
                modules+=("$module_name")
                write_color_output "Third-party module contains Android sources: $module_name" "Yellow"
            fi
        fi
    done

    if (( ${#modules[@]} > 0 )); then
        printf "%s\n" "${modules[@]}" | sort -u
    fi
}

# =========================================================
# Function: find_manual_react_packages_from_application
# Purpose: Parse Application classes to extract manually added packages
# Params: $1 project root
# Returns: print deduplicated fully-qualified class names
# =========================================================
find_manual_react_packages_from_application() {
    local project_root="$1"
    if ! command -v python3 >/dev/null 2>&1; then
        write_color_output "python3 is required to parse ReactPackage from Application sources on macOS" "Yellow"
        return
    fi

    local dirs=(
        "$project_root/android/app/src/main/java"
        "$project_root/android/src/main/java"
        "$project_root/app/android/src/main/java"
    )

    {
        for dir in "${dirs[@]}"; do
            [[ ! -d "$dir" ]] && continue
            find "$dir" -type f \( -name '*.kt' -o -name '*.java' \) -print0 2>/dev/null
        done
    } | python3 -c 'import sys,re
paths=[p.decode("utf-8","ignore") for p in sys.stdin.buffer.read().split(b"\0") if p]
results=set()
re_block=re.compile(r"/\*.*?\*/", re.S)
re_line=re.compile(r"//.*?$", re.M)
re_package=re.compile(r"^\s*package\s+([A-Za-z0-9_\.]+)", re.M)
re_import=re.compile(r"^\s*import\s+([A-Za-z0-9_\.]+)", re.M)
re_add_kotlin=re.compile(r"\badd\(\s*([A-Za-z0-9_\.]+)\s*\(", re.M)
re_add_java=re.compile(r"\b(?:packages\.)?add\(\s*new\s+([A-Za-z0-9_\.]+)", re.M)
for path in paths:
    try:
        text=open(path,"r",encoding="utf-8",errors="ignore").read()
    except OSError:
        continue
    text=re_block.sub("",text)
    text=re_line.sub("",text)
    pkg=""
    m=re_package.search(text)
    if m:
        pkg=m.group(1)
    imports={}
    for fq in re_import.findall(text):
        imports[fq.split(".")[-1]]=fq
    for name in re_add_kotlin.findall(text)+re_add_java.findall(text):
        if "." in name:
            fqcn=name
        elif name in imports:
            fqcn=imports[name]
        elif pkg:
            fqcn=pkg+"."+name
        else:
            fqcn=name
        if fqcn.endswith("Package"):
            results.add(fqcn)
print("\n".join(sorted(results)))'
}

# =========================================================
# Function: get_react_packages_from_autolinking_source
# Purpose: Parse autolinking PackageList.java and return packages
# Params: $1 project root; $2 exclude list delimited by |
# Returns: print deduplicated fully-qualified class names
# =========================================================
get_react_packages_from_autolinking_source() {
    local project_root="$1"
    local exclude_raw="${2:-}"
    local src_file="$project_root/android/app/build/generated/autolinking/src/main/java/com/facebook/react/PackageList.java"

    [[ ! -f "$src_file" ]] && { write_color_output "Autolinking PackageList.java not found: $src_file" "Yellow"; return; }

    if ! command -v python3 >/dev/null 2>&1; then
        write_color_output "python3 is required to parse autolinking PackageList.java on macOS" "Yellow"
        return
    fi

    local pkgs
    pkgs="$(python3 - "$src_file" <<'PY'
import sys, re

src = sys.argv[1]
text = open(src, "r", encoding="utf-8", errors="ignore").read()

imports = {}
for m in re.finditer(r"^\s*import\s+([A-Za-z0-9_\.]+)", text, re.M):
    fq = m.group(1)
    short = fq.split(".")[-1]
    imports[short] = fq

results = set()
for m in re.finditer(r"\bnew\s+([A-Za-z0-9_\.]+)\s*\(", text):
    name = m.group(1)
    fqcn = imports.get(name, name) if "." not in name else name
    if fqcn.endswith("Package"):
        results.add(fqcn)

for r in sorted(results):
    print(r)
PY
)"

    if [[ -z "${pkgs:-}" ]]; then
        return
    fi

    if [[ -n "$exclude_raw" ]]; then
        local IFS='|'
        local excludes=()
        read -r -a excludes <<< "$exclude_raw"
        while IFS= read -r p; do
            [[ -z "$p" ]] && continue
            local skip=0
            for ex in "${excludes[@]}"; do
                [[ "$p" == "$ex" ]] && { skip=1; break; }
            done
            [[ "$skip" -eq 0 ]] && printf "%s\n" "$p"
        done <<< "$pkgs" | sort -u
    else
        printf "%s\n" "$pkgs" | sort -u
    fi
}

# =========================================================
# Function: update_plugin_config_packages
# Purpose: Ensure build/generated PluginConfig.json has reactPackages array
# Params: $1 project root; $2 build/generated dir; $3 newline-separated list
# Returns: update JSON in place
# =========================================================
update_plugin_config_packages() {
    local project_root="$1"
    local build_generated_dir="$2"
    local packages_list="$3"
    local cfg="$build_generated_dir/PluginConfig.json"

    if [[ ! -f "$cfg" ]]; then
        local root_cfg="$project_root/PluginConfig.json"
        if [[ -f "$root_cfg" ]]; then
            cp "$root_cfg" "$cfg"
            write_color_output "Copied root PluginConfig.json to build/generated" "Blue"
        else
            write_color_output "PluginConfig.json is missing, cannot update reactPackages" "Red"
            return 1
        fi
    fi

    local arr_json
    if [[ -n "$packages_list" ]]; then
        arr_json="$(printf "%s\n" "$packages_list" | jq -R -s -c 'split("\n") | map(select(length>0))' 2>/dev/null || true)"
        if [[ -z "$arr_json" ]]; then
            if command -v python3 >/dev/null 2>&1; then
                arr_json="$(python3 -c 'import sys,json;lines=[l.strip() for l in sys.stdin.read().splitlines() if l.strip()];print(json.dumps(lines))' <<< "$packages_list")"
            else
                write_color_output "jq/python3 required to write reactPackages" "Red"
                return 1
            fi
        fi
    else
        arr_json="[]"
    fi

    if command -v jq >/dev/null 2>&1; then
        jq --argjson arr "$arr_json" '.reactPackages = $arr' "$cfg" > "${cfg}.tmp" && mv "${cfg}.tmp" "$cfg"
    elif command -v python3 >/dev/null 2>&1; then
        python3 - <<PY
import json
p="$cfg"
cfg=json.load(open(p,encoding="utf-8-sig"))
cfg["reactPackages"] = json.loads('''$arr_json''')
open(p,"w",encoding="utf-8").write(json.dumps(cfg,indent=2,ensure_ascii=False))
PY
    else
        write_color_output "jq/python3 required to update reactPackages" "Red"
        return 1
    fi

    write_color_output "Updated build/generated/PluginConfig.json with reactPackages" "Green"
}

# =========================================================
# Function: test_has_android_native_code
# Purpose: Detect Android native sources or compiled classes
# Params: $1 project root
# Returns: exit code 0 if native exists, 1 otherwise
# =========================================================
test_has_android_native_code() {
    local project_root="$1"

    for dir in "$project_root/android" "$project_root/app/android"; do
        if [[ -d "$dir" ]] && find "$dir" -type f \( -name '*.java' -o -name '*.kt' \) -quit 2>/dev/null; then
            return 0
        fi
    done

    local node_modules_dir="$project_root/node_modules"
    if [[ -d "$node_modules_dir" ]]; then
        for module in "$node_modules_dir"/* "$node_modules_dir"/@*/*; do
            [[ ! -d "$module" ]] && continue
            local name="${module#$node_modules_dir/}"
            is_ignored_module_name "$name" && continue
            for dir in "$module/android" "$module/platforms/android" "$module/platforms/android-native"; do
                if [[ -d "$dir" ]] && find "$dir" -type f \( -name '*.java' -o -name '*.kt' \) -quit 2>/dev/null; then
                    return 0
                fi
            done
        done
    fi

    local javac_dir="$project_root/android/app/build/intermediates/javac"
    if [[ -d "$javac_dir" ]]; then
        if find "$javac_dir" -type d -regex '.*/compile.*JavaWithJavac/classes' -exec find {} -type f -name '*.class' -quit \; 2>/dev/null; then
            return 0
        fi
    fi

    return 1
}

# =========================================================
# Function: ensure_build_generated_dir
# Purpose: Ensure build/generated exists
# Params: $1 project root
# Returns: print the directory path
# =========================================================
ensure_build_generated_dir() {
    local project_root="$1"
    local dir="$project_root/build/generated"
    mkdir -p "$dir"
    echo "$dir"
}

# =========================================================
# Function: ensure_node_modules_platform
# Purpose: Guard against a node_modules tree that was installed on a
#          DIFFERENT OS/arch than the host we're building on. Happens
#          most often when the project is synced between a Linux
#          sandbox (or CI container) and a developer's Mac — npm's
#          optional native binaries (esbuild, @napi-rs/canvas, …) are
#          keyed to platform+arch and throw opaque "You installed
#          esbuild for another platform" errors at runtime.
#
#          Detection uses esbuild as the canonical indicator:
#            - Does node_modules/@esbuild/<platform>-<arch>/ exist?
#          If not, node_modules was installed elsewhere and every
#          tsx-driven step (render-icons, bundle …) will fail. We fix
#          it by blowing away node_modules and re-running `npm install`
#          so every native dep — not just esbuild — comes back fresh
#          for this host. package-lock.json is preserved so the tree
#          stays reproducible.
#
#          Fails the build if `npm install` itself fails; we'd rather
#          stop than let downstream commands die with a confusing
#          esbuild stacktrace.
# Params: $1 project root
# Returns: exits on npm install failure; no-op when node_modules is
#          absent (fresh clone before first install) or esbuild isn't
#          yet present (pre-install state)
# =========================================================
ensure_node_modules_platform() {
    local project_root="$1"
    local esbuild_dir="$project_root/node_modules/@esbuild"
    [[ ! -d "$esbuild_dir" ]] && return 0

    if ! command -v node >/dev/null 2>&1; then
        return 0
    fi

    local expected
    expected="$(node -p 'process.platform + "-" + process.arch' 2>/dev/null || true)"
    [[ -z "$expected" ]] && return 0

    if [[ -d "$esbuild_dir/$expected" ]]; then
        return 0
    fi

    write_color_output "node_modules has no esbuild binary for $expected (installed on a different host); reinstalling..." "Yellow"
    (cd "$project_root" && rm -rf node_modules && npm install) \
        || { write_color_output "npm install failed during platform-mismatch recovery" "Red"; exit 1; }
    write_color_output "node_modules reinstalled for $expected" "Green"
}

# =========================================================
# Function: build_react_native_bundle
# Purpose: Generate RN bundle for Android
# Params: $1 project root; $2 project name; $3 output dir
# Returns: run npx to bundle
# =========================================================
build_react_native_bundle() {
    local project_root="$1"
    local project_name="$2"
    local output_dir="$3"

    write_color_output "Starting React Native bundling..." "Blue"
    local bundle_output="$output_dir/$project_name.bundle"
    local assets_dir="$output_dir"
    local cmd="npx react-native bundle --entry-file index.js --bundle-output \"$bundle_output\" --platform android --assets-dest \"$assets_dir\" --dev false"
    write_color_output "Executing command: $cmd" "Yellow"
    (cd "$project_root" && eval "$cmd") && write_color_output "Bundle generated: $bundle_output" "Green"
}

# =========================================================
# Function: build_android_apk
# Purpose: Build APK via gradle task when reactPackages exist
# Params: $1 project root; $2 path to build/generated/PluginConfig.json
# Returns: 0 on success, 1 on failure
# =========================================================
build_android_apk() {
    local project_root="$1"
    local gen_cfg="$2"

    local android_dir="$project_root/android"
    [[ ! -d "$android_dir" ]] && { write_color_output "android directory not found" "Red"; return 1; }

    # Gradle 8.13 cannot run on JDK > 23 (Java 24+ = class-file major 68+;
    # e.g. Java 26 fails with "Unsupported class file major version 70").
    # If JAVA_HOME isn't pinned and the active `java` is too new, prefer an
    # installed JDK 21 (then 17) via macOS java_home; error clearly if none.
    if [[ -z "${JAVA_HOME:-}" ]] && command -v java >/dev/null 2>&1; then
        local jmajor
        jmajor="$(java -version 2>&1 | sed -nE 's/.*version "([0-9]+).*/\1/p' | head -1)"
        if [[ -n "$jmajor" && "$jmajor" -gt 23 ]]; then
            if command -v /usr/libexec/java_home >/dev/null 2>&1; then
                local jh v
                for v in 21 17; do
                    if jh="$(/usr/libexec/java_home -v "$v" 2>/dev/null)"; then
                        export JAVA_HOME="$jh"
                        write_color_output "Active JDK $jmajor too new for Gradle 8.13; selected JDK $v: $JAVA_HOME" "Yellow"
                        break
                    fi
                done
            fi
            if [[ -z "${JAVA_HOME:-}" ]]; then
                write_color_output "Active JDK $jmajor is unsupported by Gradle 8.13 (needs JDK 17-21). Install JDK 21 (e.g. 'brew install temurin@21') or set JAVA_HOME." "Red"
                return 1
            fi
        fi
    fi

    write_color_output "Running gradle task: buildCustomApkDebug..." "Blue"
    local gradlew_path="$android_dir/gradlew"
    (cd "$android_dir"
        if [[ -f "$gradlew_path" ]]; then
            chmod +x "$gradlew_path"
            "$gradlew_path" buildCustomApkDebug
        elif command -v gradle >/dev/null 2>&1; then
            gradle buildCustomApkDebug
        else
            write_color_output "gradle/gradlew not found" "Red"; return 1
        fi
    ) && write_color_output "APK build succeeded" "Green" || { write_color_output "APK build failed" "Red"; return 1; }

    return 0
}

# =========================================================
# Function: copy_apk_and_update_config
# Purpose: Copy APK as app.npk into build/generated and set nativeCodePackage
# Params: $1 project root; $2 build/generated dir; $3 build/generated PluginConfig.json
# Returns: 0 on success, 1 on failure
# =========================================================
copy_apk_and_update_config() {
    local project_root="$1"
    local build_generated_dir="$2"
    local build_generated_config_file="$3"

    local apk_search="$project_root/android/app/build/outputs/apk"
    local apk_path=""
    if [[ -d "$apk_search" ]]; then
        apk_path="$(find "$apk_search" -type f -name '*custom*.apk' -print -quit 2>/dev/null || true)"
        [[ -z "$apk_path" ]] && apk_path="$(find "$apk_search" -type f -name '*.apk' -print -quit 2>/dev/null || true)"
    fi
    [[ -z "$apk_path" ]] && { write_color_output "Generated APK not found" "Red"; return 1; }

    local new_apk="app.npk"
    local target="$build_generated_dir/$new_apk"
    cp "$apk_path" "$target" && write_color_output "APK copied to: $target" "Green"

    if command -v jq >/dev/null 2>&1; then
        jq --arg path "/$new_apk" '.nativeCodePackage = $path' "$build_generated_config_file" > "${build_generated_config_file}.tmp" && mv "${build_generated_config_file}.tmp" "$build_generated_config_file"
    elif command -v python3 >/dev/null 2>&1; then
        python3 - <<PY
import json
p="$build_generated_config_file"
cfg=json.load(open(p,encoding="utf-8-sig"))
cfg["nativeCodePackage"]="/$new_apk"
open(p,"w",encoding="utf-8").write(json.dumps(cfg,indent=2,ensure_ascii=False))
PY
    else
        write_color_output "jq/python3 required to update nativeCodePackage" "Red"; return 1
    fi

    write_color_output "Updated nativeCodePackage to: /$new_apk" "Green"
    return 0
}

# =========================================================
# Function: copy_icon_and_update_path
# Purpose: Copy icon file and set iconPath in generated config
# Params: $1 project root; $2 build/generated dir; $3 build/generated PluginConfig.json
# Returns: none
# =========================================================
copy_icon_and_update_path() {
    local project_root="$1"
    local build_generated_dir="$2"
    local build_generated_config_file="$3"

    local root_cfg="$project_root/PluginConfig.json"
    [[ ! -f "$root_cfg" ]] && { write_color_output "Root PluginConfig.json not found" "Yellow"; return; }

    local icon_path=""
    if command -v jq >/dev/null 2>&1; then
        icon_path="$(jq -r '.iconPath // ""' "$root_cfg")"
    elif command -v python3 >/dev/null 2>&1; then
        icon_path="$(python3 -c "import json,sys;print((json.load(open(sys.argv[1],encoding='utf-8-sig'))).get('iconPath',''))" "$root_cfg")"
    fi

    [[ -z "$icon_path" || "$icon_path" == "null" ]] && { write_color_output "iconPath not set or empty" "Yellow"; return; }

    local source_icon_path="$icon_path"
    [[ "$icon_path" != /* ]] && source_icon_path="$project_root/$icon_path"
    if [[ ! -f "$source_icon_path" ]]; then
        write_color_output "Icon file not found: $source_icon_path" "Yellow"
        return
    fi

    local icon_file_name
    icon_file_name="$(basename "$source_icon_path")"
    local target_icon="$build_generated_dir/$icon_file_name"
    cp "$source_icon_path" "$target_icon" && write_color_output "Icon copied to: $target_icon" "Green"

    if command -v jq >/dev/null 2>&1; then
        jq --arg path "/$icon_file_name" '.iconPath = $path' "$build_generated_config_file" > "${build_generated_config_file}.tmp" && mv "${build_generated_config_file}.tmp" "$build_generated_config_file"
    elif command -v python3 >/dev/null 2>&1; then
        python3 - <<PY
import json
p="$build_generated_config_file"
cfg=json.load(open(p,encoding="utf-8-sig"))
cfg["iconPath"]="/$icon_file_name"
open(p,"w",encoding="utf-8").write(json.dumps(cfg,indent=2,ensure_ascii=False))
PY
    fi
    write_color_output "Updated iconPath to: /$icon_file_name" "Green"
}

# =========================================================
# Function: ensure_build_outputs_directory
# Purpose: Ensure build/outputs exists
# Params: $1 project root
# Returns: print the directory path
# =========================================================
ensure_build_outputs_directory() {
    local project_root="$1"
    local dir="$project_root/build/outputs"
    mkdir -p "$dir"
    echo "$dir"
}

# =========================================================
# Function: new_zip_package
# Purpose: Create a zip from build/generated directory
# Params: $1 source dir; $2 destination zip path
# Returns: 0 on success, 1 on failure
# =========================================================
new_zip_package() {
    local source_dir="$1"
    local destination_path="$2"

    write_color_output "Packaging directory: $source_dir" "Blue"
    [[ ! -d "$source_dir" ]] && { write_color_output "Source directory does not exist" "Red"; return 1; }
    [[ -z "$(ls -A "$source_dir")" ]] && { write_color_output "Source directory is empty" "Yellow"; return 1; }
    [[ -f "$destination_path" ]] && rm -f "$destination_path"

    if command -v zip >/dev/null 2>&1; then
        (cd "$source_dir" && zip -r "$destination_path" .) && write_color_output "Zip created: $destination_path" "Green" || { write_color_output "Failed to create zip" "Red"; return 1; }
    else
        write_color_output "zip command not found" "Red"; return 1
    fi
    return 0
}

# =========================================================
# Function: rename_to_snplg_file
# Purpose: Copy zip to project_name.snplg
# Params: $1 zip path; $2 project name
# Returns: print .snplg file path
# =========================================================
rename_to_snplg_file() {
    local zip_file_path="$1"
    local project_name="$2"
    local snplg="${zip_file_path%/*}/$project_name.snplg"
    cp "$zip_file_path" "$snplg"
    write_color_output "Plugin package created: $snplg" "Green"
    echo "$snplg"
}

# =========================================================
# Function: main
# Purpose: Orchestrate all steps to build plugin package
# Params: $1 project root (optional, defaults to current directory)
# Returns: none
# =========================================================
main() {
    test_operating_system

    local project_root="${1:-$(pwd)}"
    get_package_info "$project_root"

    # Pull PluginConfig.json's versionName/versionCode forward from
    # package.json before anything downstream touches the config. Without
    # this, the on-device plugin card stays pinned to whatever the
    # scaffold seeded (e.g. 0.1.0) forever.
    sync_plugin_config_version "$project_root"

    local gen_dir
    gen_dir="$(ensure_build_generated_dir "$project_root")"

    # Guard against node_modules carrying native binaries for a different
    # host (common when syncing the tree between a Linux sandbox/CI and
    # the dev's Mac). Runs before any npm step so the RN bundler never
    # hits an opaque platform-mismatch stacktrace.
    ensure_node_modules_platform "$project_root"

    # Stage the WordNet StarDict source (fetch:dict) and regenerate the
    # bundled base data (build:dict). prepare:dict is RETAINED until the
    # native SQLite path passes the TF1 on-device spike (ADR-0001): the
    # base64 blob it emits is revert-safety, not the runtime path — the
    # runtime reads base.db, built+staged below. Idempotent: fetch:dict
    # skips the download if the source files are already present.
    write_color_output "Preparing base dictionary..." "Blue"
    (cd "$project_root" && npm run --silent prepare:dict) \
        || { write_color_output "Base dictionary preparation failed" "Red"; exit 1; }

    # Build the bundled SQLite base.db and stage it as an APK asset.
    # react-native-sqlite-storage's createFromLocation reads
    # assets/base.db (index.js wires createFromAsset:"~base.db", FLAG 1),
    # so the .db must live at android/app/src/main/assets/base.db. The
    # noCompress 'db' aaptOptions rule keeps it readable as a DB.
    write_color_output "Building + staging base.db SQLite asset..." "Blue"
    (cd "$project_root" && npm run --silent build:base-db) \
        || { write_color_output "base.db build failed" "Red"; exit 1; }
    local assets_dest="$project_root/android/app/src/main/assets"
    mkdir -p "$assets_dest" \
        || { write_color_output "Could not create assets dir: $assets_dest" "Red"; exit 1; }
    cp "$project_root/build/base.db" "$assets_dest/base.db" \
        || { write_color_output "Could not stage base.db into $assets_dest" "Red"; exit 1; }
    write_color_output "Staged base.db -> $assets_dest/base.db" "Green"

    build_react_native_bundle "$project_root" "$PACKAGE_NAME" "$gen_dir"

    local root_cfg="$project_root/PluginConfig.json"
    if [[ -f "$root_cfg" ]]; then
        write_color_output "Detected root directory PluginConfig.json file already exists, skipping generation step" "Yellow"
    else
        local plugin_id
        plugin_id="$(new_random_string 16)"
        new_plugin_config "$plugin_id" "$project_root"
    fi

    local gen_cfg="$gen_dir/PluginConfig.json"
    cp "$root_cfg" "$gen_cfg"
    copy_icon_and_update_path "$project_root" "$gen_dir" "$gen_cfg"

    local project_react_pkgs
    project_react_pkgs="$(find_manual_react_packages_from_application "$project_root" || true)"

    local third_party_native_mods
    third_party_native_mods="$(scan_node_modules_native_code "$project_root" || true)"

    local should_build_native=1
    if printf "%s\n" "$project_react_pkgs" | awk 'NF{found=1} END{exit(found?0:1)}'; then
        should_build_native=0
    elif printf "%s\n" "$third_party_native_mods" | awk 'NF{found=1} END{exit(found?0:1)}'; then
        should_build_native=0
    fi

    if [[ "$should_build_native" -eq 0 ]]; then
        local autolink_pkgs
        autolink_pkgs="$(get_react_packages_from_autolinking_source "$project_root" "com.facebook.react.shell.MainReactPackage|com.ratta.supernote.note.plugincore.PluginPackage|com.ratta.supernote.pluginlib.PluginPackage" || true)"

        local all_pkgs
        all_pkgs="$(printf "%s\n%s\n" "$project_react_pkgs" "$autolink_pkgs" | awk 'NF' | sort -u)"
        update_plugin_config_packages "$project_root" "$gen_dir" "$all_pkgs"

        if build_android_apk "$project_root" "$gen_cfg"; then
            copy_apk_and_update_config "$project_root" "$gen_dir" "$gen_cfg" || true
        else
            write_color_output "APK build failed" "Red"
        fi
    else
        write_color_output "Build conditions not met; skipping native build and reactPackages update" "Yellow"
    fi

    local outputs_dir
    outputs_dir="$(ensure_build_outputs_directory "$project_root")"
    local zip_path="$outputs_dir/${PACKAGE_NAME}.zip"
    if new_zip_package "$gen_dir" "$zip_path"; then
        rename_to_snplg_file "$zip_path" "$PACKAGE_NAME" >/dev/null
    fi

    write_color_output "Build process completed" "Blue"
}

main "$@"
