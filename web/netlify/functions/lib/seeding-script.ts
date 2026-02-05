export function generateSeedingScript(params: {
  sourceUrl: string;
  gcsServiceAccountJson: string;
  filesystemName: string;
}): string {
  const { sourceUrl, gcsServiceAccountJson, filesystemName } = params;

  // Escape single quotes in JSON for safe shell embedding
  const escapedJson = gcsServiceAccountJson.replace(/'/g, "'\\''");

  return `#!/bin/bash
set -euo pipefail

echo "=== Starting filesystem seeding ==="
echo "Target filesystem: /lambda/nfs/${filesystemName}"
echo "Source: ${sourceUrl}"

echo "Installing gsutil..."
pip3 install gsutil --quiet

echo "Authenticating with GCS..."
echo '${escapedJson}' > /tmp/gcs-key.json
gcloud auth activate-service-account --key-file=/tmp/gcs-key.json

echo "Downloading data from ${sourceUrl}..."
gsutil -m cp -r ${sourceUrl}/* /lambda/nfs/${filesystemName}/

echo "Download complete! Filesystem contents:"
du -sh /lambda/nfs/${filesystemName}/
ls -lh /lambda/nfs/${filesystemName}/ | head -20

echo "Cleaning up credentials..."
rm -f /tmp/gcs-key.json

echo "Writing completion marker..."
touch /tmp/seeding-complete

echo "=== Seeding complete ==="
`;
}
