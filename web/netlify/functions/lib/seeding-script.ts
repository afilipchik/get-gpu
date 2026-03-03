export function generateSeedingScript(params: {
  sourceType: "gcs" | "r2";
  sourceUrl: string;
  credentials: string;
  filesystemName: string;
  downloadScript?: string;
}): string {
  const { sourceType, sourceUrl, credentials, filesystemName, downloadScript } = params;

  const escapedCreds = credentials.replace(/'/g, "'\\''");
  const nfsPath = `/lambda/nfs/${filesystemName}`;
  const seedStatus = `${nfsPath}/.seed-status`;

  let downloadSection: string;

  if (downloadScript) {
    const gcsAuthStep = sourceType === "gcs" ? `
echo "[seed] Authenticating with GCS..."
gcloud auth activate-service-account --key-file="$CREDS_FILE"
` : "";
    downloadSection = `
export CREDS_FILE="/tmp/seed-credentials-${filesystemName}.json"
echo '${escapedCreds}' > "$CREDS_FILE"
export NFS_PATH='${nfsPath}'
${gcsAuthStep}
echo "[seed] Running custom download script..."
${downloadScript}

rm -f "$CREDS_FILE"
`;
  } else if (sourceType === "gcs") {
    downloadSection = `
echo "[seed] Installing gsutil..."
pip3 install gsutil --quiet

echo "[seed] Authenticating with GCS..."
echo '${escapedCreds}' > /tmp/gcs-key-${filesystemName}.json
gcloud auth activate-service-account --key-file=/tmp/gcs-key-${filesystemName}.json

echo "[seed] Downloading data from ${sourceUrl}..."
gsutil -m cp -r '${sourceUrl}'/* '${nfsPath}'/

rm -f /tmp/gcs-key-${filesystemName}.json
`;
  } else {
    downloadSection = `
echo "[seed] Configuring R2 credentials..."
R2_CREDS='${escapedCreds}'
R2_ACCOUNT_ID=$(echo "$R2_CREDS" | python3 -c "import sys,json; print(json.load(sys.stdin)['accountId'])")
R2_ACCESS_KEY=$(echo "$R2_CREDS" | python3 -c "import sys,json; print(json.load(sys.stdin)['accessKeyId'])")
R2_SECRET_KEY=$(echo "$R2_CREDS" | python3 -c "import sys,json; print(json.load(sys.stdin)['secretAccessKey'])")

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY"

ENDPOINT_URL="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"

echo "[seed] Downloading data from ${sourceUrl}..."
aws s3 cp --recursive --endpoint-url "$ENDPOINT_URL" '${sourceUrl}' '${nfsPath}'/

unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
`;
  }

  // Generate a self-contained bash snippet (not a full script — will be embedded in user_data).
  // Uses a subshell with its own error handling so a seed failure doesn't kill the whole boot.
  return `
# === Filesystem seeding: ${filesystemName} ===
(
  SEED_STATUS='${seedStatus}'
  NFS_PATH='${nfsPath}'
  STALE_SECONDS=300

  seed_check_ready() {
    [ -f "$SEED_STATUS" ] && grep -q "status=ready" "$SEED_STATUS"
  }

  seed_check_active() {
    if [ ! -f "$SEED_STATUS" ]; then return 1; fi
    if ! grep -q "status=seeding" "$SEED_STATUS"; then return 1; fi
    LAST_HB=$(grep "last_heartbeat=" "$SEED_STATUS" | cut -d= -f2)
    if [ -z "$LAST_HB" ]; then return 1; fi
    LAST_HB_TS=$(date -d "$LAST_HB" +%s 2>/dev/null || echo 0)
    NOW_TS=$(date +%s)
    [ $((NOW_TS - LAST_HB_TS)) -lt $STALE_SECONDS ]
  }

  # Check if already ready
  if seed_check_ready; then
    echo "[seed] FS ${filesystemName} already seeded, remounting readonly"
    sudo mount -o remount,ro '${nfsPath}' 2>/dev/null || true
    exit 0
  fi

  # Check if another VM is actively seeding
  if seed_check_active; then
    echo "[seed] Another VM is seeding ${filesystemName}, waiting..."
    while true; do
      sleep 30
      if seed_check_ready; then
        echo "[seed] FS ${filesystemName} seeding complete, remounting readonly"
        sudo mount -o remount,ro '${nfsPath}' 2>/dev/null || true
        exit 0
      fi
      if ! seed_check_active; then
        echo "[seed] Seeder appears stale, taking over..."
        break
      fi
    done
  fi

  # Claim lock and start seeding
  echo "[seed] Claiming seed lock for ${filesystemName}"
  echo "status=seeding
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
pid=$$
last_heartbeat=$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SEED_STATUS"

  # Start heartbeat in background
  (
    while kill -0 $$ 2>/dev/null; do
      sleep 30
      sed -i "s/last_heartbeat=.*/last_heartbeat=$(date -u +%Y-%m-%dT%H:%M:%SZ)/" "$SEED_STATUS" 2>/dev/null || true
    done
  ) &
  HEARTBEAT_PID=$!

  echo "[seed] Starting download for ${filesystemName}"
  echo "[seed] Target: ${nfsPath}"
  echo "[seed] Source: ${sourceUrl} (${sourceType})"
${downloadSection}
  echo "[seed] Download complete!"
  du -sh '${nfsPath}'/ 2>/dev/null || true
  ls -lh '${nfsPath}'/ 2>/dev/null | head -20

  # Stop heartbeat and mark ready
  kill $HEARTBEAT_PID 2>/dev/null || true
  wait $HEARTBEAT_PID 2>/dev/null || true
  echo "status=ready
completed=$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SEED_STATUS"

  echo "[seed] FS ${filesystemName} seeding complete, remounting readonly"
  sudo mount -o remount,ro '${nfsPath}' 2>/dev/null || true
) || echo "[seed] WARNING: Seeding failed for ${filesystemName}, continuing boot"
`;
}
