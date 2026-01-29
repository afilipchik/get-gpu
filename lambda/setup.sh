#!/bin/bash
#
# GPU Instance Setup Script
#

set -euo pipefail

echo "Installing Ray..."
pip3 install "ray[default]" --quiet

echo "Done. Ray $(python3 -c 'import ray; print(ray.__version__)') installed."
