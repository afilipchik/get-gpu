# get-gpu

CLI and web dashboard for provisioning GPU instances from Lambda Labs.

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

### Cleanup all resources

Terminate all instances and delete all filesystems:

```bash
./lambda/provision-gpu.sh cleanup
```

### Interactive mode

When run without required options, the script guides you through GPU and SSH key selection:

```bash
# Full interactive mode - prompts for GPU and SSH key
./lambda/provision-gpu.sh provision

# Prompts for SSH key only
./lambda/provision-gpu.sh provision -g gpu_1x_a100

# Prompts for GPU only
./lambda/provision-gpu.sh provision -k my-ssh-key

# Interactive SSH key selection for cheapest GPU
./lambda/provision-gpu.sh cheapest
```

Interactive features:
- **GPU selection**: Shows available GPUs sorted by price with regions
- **SSH key selection**: Choose from:
  - Keys already registered with Lambda Labs `[registered]`
  - Local `~/.ssh/*.pub` keys `[local - will be registered]`
  - Generate a new SSH key (default name: `cloudkitchens-challenge`)
- **Region selection**: When multiple regions are available for a GPU

Note: Interactive mode requires a terminal. When piped or in auto mode (`-y`), all required options must be provided.

### Auto-confirm mode

Add `-y` to skip all confirmation prompts (disables interactive mode):

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

## Web Dashboard

A self-service web UI for launching, restarting, and terminating GPU instances. Deployed on Netlify with Auth0 authentication.

### Features

- **Candidate dashboard** — launch GPU instances, view active/terminated VMs, track spend against a quota budget, attach persistent filesystems
- **Admin dashboard** — manage allowlisted candidates and quotas, view all VMs across users, configure Lambda API key and setup scripts, view filesystems
- **Instance management** — launch, restart, and terminate instances with confirmation prompts
- **SSH key persistence** — public key is saved in the browser so you don't re-enter it between launches
- **Live cost tracking** — per-minute accrued cost updates in real time

### Tech Stack

- React 18 + TypeScript + Vite (frontend)
- Netlify Functions (backend API)
- Netlify Blobs (data store)
- Auth0 (authentication)
- Lambda Labs API (GPU provisioning)

### Local Development

```bash
cd web
npm install
npm run dev
```

For the full backend (Netlify Functions + Blobs), use the Netlify CLI:

```bash
npx netlify dev
```

### Environment Variables

| Variable | Description |
|---|---|
| `LAMBDA_API_KEY` | Lambda Labs API key (can also be set via admin UI) |
| `AUTH0_DOMAIN` | Auth0 tenant domain |
| `AUTH0_CLIENT_ID` | Auth0 SPA client ID |
| `AUTH0_AUDIENCE` | Auth0 API audience |

### API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/auth/me` | Current user profile |
| GET | `/api/gpu-types` | Available GPU types with pricing |
| GET | `/api/vms` | List VMs for the authenticated user |
| POST | `/api/vms/launch` | Launch a new instance |
| POST | `/api/vms/restart` | Restart an active instance |
| POST | `/api/vms/terminate` | Terminate an active instance |
| GET | `/api/filesystems` | List persistent filesystems |
| GET | `/api/admin/candidates` | List allowlisted candidates (admin) |
| POST | `/api/admin/candidates` | Add a candidate (admin) |
| DELETE | `/api/admin/candidates` | Remove a candidate (admin) |
| POST | `/api/admin/quota` | Set candidate quota (admin) |
| GET/PUT | `/api/admin/settings` | Read/update admin settings |

## License

MIT
