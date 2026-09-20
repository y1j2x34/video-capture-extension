#!/usr/bin/env bash
#
# Package the extension as a signed CRX3 file using Chrome's own packer, so the
# result is accepted by Chrome and Chromium-based browsers.
#
#   ./pack-crx.sh [options]
#
#     -k, --key PATH   signing key (default: keys/extension-key.pem)
#     -o, --out PATH   output file (default: dist/<extension-name>.crx)
#     -z, --zip        also write dist/<extension-name>.zip
#     -h, --help       show this help
#
#   Environment overrides: CRX_KEY, CRX_OUT, CHROME
#
# The signing key fixes the extension ID, so every build installs as the same
# extension. The key is private: keep it out of version control.
#
set -euo pipefail

# Files that ship inside the package, relative to the project root.
RUNTIME_FILES=(manifest.json background.js content.js content.css)
ICON_GLOB='icons/*'

die() { printf 'pack-crx: %s\n' "$*" >&2; exit 1; }
note() { printf '  %s\n' "$*"; }

usage() {
  cat <<'EOF'
Package the extension as a signed CRX3 file using Chrome's own packer.

  ./pack-crx.sh [options]

    -k, --key PATH   signing key (default: keys/extension-key.pem)
    -o, --out PATH   output file (default: dist/<extension-name>.crx)
    -z, --zip        also write dist/<extension-name>.zip
    -h, --help       show this help

Environment overrides: CRX_KEY, CRX_OUT, CHROME

The signing key fixes the extension ID, so every build installs as the same
extension. The key is private: keep it out of version control.
EOF
}

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$root"

key=${CRX_KEY:-keys/extension-key.pem}
out=${CRX_OUT:-}
with_zip=0

while (($# > 0)); do
  case $1 in
    -k | --key)
      [[ $# -ge 2 ]] || die "$1 requires a path"
      key=$2
      shift 2
      ;;
    -o | --out)
      [[ $# -ge 2 ]] || die "$1 requires a path"
      out=$2
      shift 2
      ;;
    -z | --zip)
      with_zip=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      die "unknown option: $1 (try --help)"
      ;;
    *)
      die "unexpected argument: $1 (try --help)"
      ;;
  esac
done

[[ -f manifest.json ]] || die "manifest.json not found in $root"

manifest_field() {
  local value
  value=$(sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' manifest.json)
  printf '%s' "${value%%$'\n'*}"
}

name=$(manifest_field name)
version=$(manifest_field version)
[[ -n $name && -n $version ]] || die 'manifest.json: cannot read "name" and "version"'

slug=$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\+/-/g; s/^-//; s/-$//')
[[ -n $slug ]] || slug=extension
[[ -n $out ]] || out="dist/$slug.crx"

chrome=${CHROME:-}
if [[ -n $chrome ]]; then
  [[ -x $chrome ]] || die "CHROME=$chrome is not executable"
else
  for candidate in google-chrome google-chrome-stable chromium chromium-browser chrome; do
    if resolved=$(command -v "$candidate" 2>/dev/null); then
      chrome=$resolved
      break
    fi
  done
  [[ -n $chrome ]] || die 'no Chrome or Chromium found; set CHROME=/path/to/chrome'
fi

if [[ ! -f $key ]]; then
  command -v openssl >/dev/null 2>&1 || die "openssl is required to create the signing key $key"
  mkdir -p -- "$(dirname -- "$key")"
  note "signing key not found, generating $key"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$key" >/dev/null 2>&1 ||
    die "openssl failed to generate $key"
  chmod 600 -- "$key"
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/pack-crx.XXXXXX")
trap 'rm -rf -- "$work"' EXIT
stage=$work/$slug
mkdir -p -- "$stage"

shopt -s nullglob
icons=($ICON_GLOB)
shopt -u nullglob
files=("${RUNTIME_FILES[@]}")
((${#icons[@]})) && files+=("${icons[@]}")
cp --parents -t "$stage" "${files[@]}"

if ! chrome_output=$("$chrome" \
  --pack-extension="$stage" \
  --pack-extension-key="$key" \
  --user-data-dir="$work/profile" \
  --no-message-box \
  --headless=new 2>&1); then
  printf '%s\n' "$chrome_output" >&2
  die 'Chrome failed to pack the extension'
fi

packed=$stage.crx
if [[ ! -f $packed ]]; then
  printf '%s\n' "$chrome_output" >&2
  die "Chrome did not produce $packed"
fi

[[ $(head -c 4 -- "$packed") == Cr24 ]] || die "Chrome produced an invalid package: $packed"

if command -v unzip >/dev/null 2>&1; then
  # `unzip` flags the CRX preamble as "extra bytes" and exits non-zero; only the
  # listing is meaningful here.
  listing=$(unzip -Z1 "$packed" 2>/dev/null | sort || :)
  expected=$(printf '%s\n' "${files[@]}" | sort)
  [[ $listing == "$expected" ]] || die "package contents do not match the expected files:
$listing"
fi

mkdir -p -- "$(dirname -- "$out")"
mv -- "$packed" "$out"
chmod 644 -- "$out"

printf '%s v%s\n' "$name" "$version"
note "crx: $out ($(stat -c %s -- "$out") bytes)"

if ((with_zip)); then
  command -v zip >/dev/null 2>&1 || die 'zip is required by --zip'
  zip_path=${out%.*}.zip
  if [[ $zip_path != /* ]]; then zip_path=$root/$zip_path; fi
  (cd "$stage" && zip -X -q -r "$zip_path" .)
  note "zip: $zip_path ($(stat -c %s -- "$zip_path") bytes)"
fi

if command -v openssl >/dev/null 2>&1 && openssl rsa -in "$key" -noout -check >/dev/null 2>&1; then
  id=$(openssl rsa -in "$key" -pubout -outform DER 2>/dev/null | sha256sum | cut -c1-32 |
    tr '0123456789abcdef' 'abcdefghijklmnop')
  note "extension id: $id"
fi

note "signing key: $key (fixes the extension id, keep it out of version control)"