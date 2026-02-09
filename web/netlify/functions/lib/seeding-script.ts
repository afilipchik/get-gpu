export function generateSeedingScript(params: {
  sourceType: "gcs" | "r2";
  sourceUrl: string;
  credentials: string;
  filesystemName: string;
  callbackUrl: string;
  callbackSecret: string;
  region: string;
}): string {
  const { sourceType, sourceUrl, credentials, filesystemName, callbackUrl, callbackSecret, region } = params;

  const escapedCreds = credentials.replace(/'/g, "'\\''");
  const nfsPath = `/lambda/nfs/${filesystemName}`;

  let downloadSection: string;

  if (sourceType === "gcs") {
    downloadSection = `
echo "Installing gsutil..."
pip3 install gsutil --quiet

echo "Authenticating with GCS..."
echo '${escapedCreds}' > /tmp/gcs-key.json
gcloud auth activate-service-account --key-file=/tmp/gcs-key.json

echo "Downloading data from ${sourceUrl}..."
gsutil -m cp -r '${sourceUrl}'/* '${nfsPath}'/

rm -f /tmp/gcs-key.json
`;
  } else {
    // R2: credentials JSON expected as { "accountId": "...", "accessKeyId": "...", "secretAccessKey": "..." }
    downloadSection = `
echo "Configuring R2 credentials..."
R2_CREDS='${escapedCreds}'
R2_ACCOUNT_ID=$(echo "$R2_CREDS" | python3 -c "import sys,json; print(json.load(sys.stdin)['accountId'])")
R2_ACCESS_KEY=$(echo "$R2_CREDS" | python3 -c "import sys,json; print(json.load(sys.stdin)['accessKeyId'])")
R2_SECRET_KEY=$(echo "$R2_CREDS" | python3 -c "import sys,json; print(json.load(sys.stdin)['secretAccessKey'])")

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_KEY"

ENDPOINT_URL="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com"

echo "Downloading data from ${sourceUrl}..."
aws s3 cp --recursive --endpoint-url "$ENDPOINT_URL" '${sourceUrl}' '${nfsPath}'/

unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
`;
  }

  return `#!/bin/bash
set -euo pipefail

echo "=== Starting filesystem seeding ==="
echo "Target: ${nfsPath}"
echo "Source: ${sourceUrl} (${sourceType})"
${downloadSection}
echo "Download complete!"
du -sh '${nfsPath}'/
ls -lh '${nfsPath}'/ | head -20

echo "Reporting completion..."
curl -sf -X POST '${callbackUrl}' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer ${callbackSecret}' \\
  -d '{"filesystemName":"${filesystemName}","region":"${region}"}' || echo "Warning: callback failed"

echo "Remounting filesystem as read-only..."
sudo mount -o remount,ro '${nfsPath}'

echo "=== Seeding complete, shutting down ==="
sudo shutdown -h now
`;
}
