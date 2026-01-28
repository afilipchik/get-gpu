# get-gpu

A CLI tool for provisioning GPU instances from Lambda Labs.

## Features

- Provision specific GPU types in specific or any available region
- Find and provision the cheapest available GPU
- Wait for GPU availability with configurable polling
- Manage SSH keys and persistent filesystems
- Interactive or fully automated (auto-confirm) mode
- List and terminate instances

## Prerequisites

- `jq` - JSON processor (`brew install jq` on macOS, `apt install jq` on Linux)
- `curl` - HTTP client (usually pre-installed)
- Lambda Labs API key - Get one at https://cloud.lambdalabs.com/api-keys

## Installation

```bash
git clone https://github.com/afilipchik/get-gpu.git
cd get-gpu
chmod +x lambda/provision-gpu.sh
```

## Configuration

Set your API key as an environment variable:

```bash
export LAMBDA_API_KEY="your-api-key"
```

Or use a key file with the `-a` option:

```bash
./lambda/provision-gpu.sh list -a ~/lambda-api-key.txt
```

## Usage

### List available GPUs

```bash
./lambda/provision-gpu.sh list
```

### List all GPU types (including unavailable)

```bash
./lambda/provision-gpu.sh list-all
```

### Provision a specific GPU

```bash
# In a specific region
./lambda/provision-gpu.sh provision -g gpu_1x_a100 -r us-west-1 -k my-ssh-key

# In any available region
./lambda/provision-gpu.sh provision -g gpu_1x_a100 -k my-ssh-key
```

### Provision the cheapest available GPU

```bash
./lambda/provision-gpu.sh cheapest -k my-ssh-key
```

### Wait for GPU availability

```bash
./lambda/provision-gpu.sh provision -g gpu_1x_h100 -k my-ssh-key --wait
```

### Provision with a persistent filesystem

```bash
./lambda/provision-gpu.sh provision -g gpu_1x_a100 -k my-ssh-key -s my-storage
```

The filesystem will be created if it doesn't exist and mounted at `/lambda/nfs/my-storage`.

### Create SSH key from file

```bash
./lambda/provision-gpu.sh provision -g gpu_1x_a100 -k my-new-key -f ~/.ssh/id_rsa.pub
```

### List running instances

```bash
./lambda/provision-gpu.sh instances
```

### Terminate an instance

```bash
./lambda/provision-gpu.sh terminate <instance-id>
```

### Auto-confirm mode

Add `-y` to skip all confirmation prompts:

```bash
./lambda/provision-gpu.sh provision -g gpu_1x_a100 -k my-ssh-key -y
```

## All Options

| Option | Description |
|--------|-------------|
| `-a, --api-key-file PATH` | Path to file containing API key |
| `-g, --gpu TYPE` | GPU instance type (e.g., gpu_1x_a100) |
| `-r, --region REGION` | Target region (e.g., us-west-1) |
| `-k, --ssh-key NAME` | SSH key name (required for provision) |
| `-f, --ssh-key-file PATH` | Path to public SSH key file |
| `-n, --name NAME` | Instance name |
| `-s, --filesystem NAME` | Filesystem name (creates if needed) |
| `-w, --wait` | Wait for GPU availability |
| `-y, --yes` | Auto-confirm all prompts |
| `--poll-interval SECS` | Seconds between availability checks (default: 60) |
| `--max-wait SECS` | Maximum wait time in seconds (default: 86400) |

## License

MIT
