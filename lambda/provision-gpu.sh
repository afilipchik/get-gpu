#!/bin/bash
#
# Lambda Labs GPU Provisioning Script
#
# Features:
# - Pick specific GPU in specific region
# - Pick specific GPU in any available region
# - Pick cheapest GPU in any region
# - Create/attach filesystems
# - Load SSH key from file
# - Wait for availability
# - Interactive or auto mode
# - Run init script on provisioned instance
#
# API Documentation: https://cloud.lambdalabs.com/api/v1/docs
#

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

API_BASE="https://cloud.lambdalabs.com/api/v1"
POLL_INTERVAL=60  # seconds between availability checks
MAX_WAIT_TIME=86400  # maximum wait time in seconds (24 hours)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# Utility Functions
# ============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" >&2
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

die() {
    log_error "$1"
    exit 1
}

confirm() {
    local prompt="$1"
    if [[ "$AUTO_MODE" == "true" ]]; then
        log_info "Auto-mode: proceeding with $prompt"
        return 0
    fi

    echo -en "${YELLOW}[CONFIRM]${NC} $prompt (y/n): "
    read -r response
    case "$response" in
        [yY][eE][sS]|[yY]) return 0 ;;
        *) return 1 ;;
    esac
}

api_call() {
    local method="$1"
    local endpoint="$2"
    local data="${3:-}"

    local curl_args=(
        -s
        -X "$method"
        -u "${LAMBDA_API_KEY}:"
        -H "Content-Type: application/json"
    )

    if [[ -n "$data" ]]; then
        curl_args+=(-d "$data")
    fi

    curl "${curl_args[@]}" "${API_BASE}${endpoint}"
}

check_jq() {
    if ! command -v jq &> /dev/null; then
        die "jq is required but not installed. Install with: brew install jq (macOS) or apt install jq (Linux)"
    fi
}

load_api_key_from_file() {
    local file="$1"
    if [[ ! -f "$file" ]]; then
        die "API key file not found: $file"
    fi
    # Read first line, trim whitespace
    LAMBDA_API_KEY=$(head -n1 "$file" | tr -d '[:space:]')
    if [[ -z "$LAMBDA_API_KEY" ]]; then
        die "API key file is empty: $file"
    fi
    export LAMBDA_API_KEY
}

check_api_key() {
    if [[ -z "${LAMBDA_API_KEY:-}" ]]; then
        die "LAMBDA_API_KEY not set. Use --api-key-file or set LAMBDA_API_KEY environment variable. Get your API key from https://cloud.lambdalabs.com/api-keys"
    fi
}

is_interactive() {
    [[ -t 0 ]]
}

prompt_selection() {
    local prompt="$1"
    local max="$2"
    local selection

    while true; do
        echo -en "${YELLOW}[SELECT]${NC} $prompt (1-$max): " >&2
        read -r selection
        if [[ "$selection" =~ ^[0-9]+$ ]] && [[ "$selection" -ge 1 ]] && [[ "$selection" -le "$max" ]]; then
            echo "$selection"
            return 0
        fi
        log_error "Invalid selection. Please enter a number between 1 and $max."
    done
}

# ============================================================================
# API Functions
# ============================================================================

get_instance_types() {
    api_call GET "/instance-types"
}

get_instances() {
    api_call GET "/instances"
}

get_instance() {
    local instance_id="$1"
    api_call GET "/instances/${instance_id}"
}

get_ssh_keys() {
    api_call GET "/ssh-keys"
}

add_ssh_key() {
    local name="$1"
    local public_key="$2"
    api_call POST "/ssh-keys" "{\"name\": \"$name\", \"public_key\": \"$public_key\"}"
}

get_filesystems() {
    api_call GET "/file-systems"
}

create_filesystem() {
    local name="$1"
    local region="$2"
    api_call POST "/file-systems" "{\"name\": \"$name\", \"region\": \"$region\"}"
}

launch_instance() {
    local instance_type="$1"
    local region="$2"
    local ssh_key_names="$3"
    local name="${4:-}"
    local filesystem_names="${5:-}"

    local payload
    payload=$(jq -n \
        --arg type "$instance_type" \
        --arg region "$region" \
        --argjson ssh_keys "$ssh_key_names" \
        --argjson filesystems "${filesystem_names:-[]}" \
        --arg name "$name" \
        '{
            instance_type_name: $type,
            region_name: $region,
            ssh_key_names: $ssh_keys,
            file_system_names: $filesystems,
            quantity: 1
        } + (if $name != "" then {name: $name} else {} end)'
    )

    api_call POST "/instance-operations/launch" "$payload"
}

terminate_instance() {
    local instance_id="$1"
    api_call POST "/instance-operations/terminate" "{\"instance_ids\": [\"$instance_id\"]}"
}

delete_filesystem() {
    local filesystem_id="$1"
    # Note: Lambda API uses /filesystems (no hyphen) for DELETE, but /file-systems for GET/POST
    api_call DELETE "/filesystems/${filesystem_id}"
}

# ============================================================================
# Business Logic Functions
# ============================================================================

list_available_gpus() {
    log_info "Fetching available GPU types..."
    local response
    response=$(get_instance_types)

    if echo "$response" | jq -e '.error' &>/dev/null; then
        die "API error: $(echo "$response" | jq -r '.error.message // .error')"
    fi

    echo "$response" | jq -r '
        .data | to_entries[] |
        select(.value.regions_with_capacity_available | length > 0) |
        "\(.key)\t$\(.value.instance_type.price_cents_per_hour/100)/hr\t\(.value.instance_type.description)\tRegions: \(.value.regions_with_capacity_available | map(.name) | join(", "))"
    ' | column -t -s $'\t'
}

list_all_gpus() {
    log_info "Fetching all GPU types (including unavailable)..."
    local response
    response=$(get_instance_types)

    if echo "$response" | jq -e '.error' &>/dev/null; then
        die "API error: $(echo "$response" | jq -r '.error.message // .error')"
    fi

    echo "$response" | jq -r '
        .data | to_entries[] |
        "\(.key)\t$\(.value.instance_type.price_cents_per_hour/100)/hr\t\(.value.instance_type.description)\t\(if (.value.regions_with_capacity_available | length > 0) then "Available: " + (.value.regions_with_capacity_available | map(.name) | join(", ")) else "UNAVAILABLE" end)"
    ' | column -t -s $'\t'
}

find_gpu_in_region() {
    local gpu_type="$1"
    local region="$2"
    local response
    response=$(get_instance_types)

    echo "$response" | jq -e --arg gpu "$gpu_type" --arg region "$region" '
        .data[$gpu].regions_with_capacity_available |
        map(select(.name == $region)) |
        length > 0
    ' &>/dev/null
}

find_gpu_any_region() {
    local gpu_type="$1"
    local response
    response=$(get_instance_types)

    # Return first available region for this GPU type
    echo "$response" | jq -r --arg gpu "$gpu_type" '
        .data[$gpu].regions_with_capacity_available[0].name // empty
    '
}

find_cheapest_gpu() {
    local response
    response=$(get_instance_types)

    # Find cheapest available GPU
    echo "$response" | jq -r '
        [.data | to_entries[] |
        select(.value.regions_with_capacity_available | length > 0) |
        {
            name: .key,
            price: .value.instance_type.price_cents_per_hour,
            region: .value.regions_with_capacity_available[0].name,
            description: .value.instance_type.description
        }] |
        sort_by(.price) |
        .[0] |
        "\(.name)\t\(.region)\t\(.price)\t\(.description)"
    '
}

get_gpu_price() {
    local gpu_type="$1"
    local response
    response=$(get_instance_types)

    echo "$response" | jq -r --arg gpu "$gpu_type" '
        .data[$gpu].instance_type.price_cents_per_hour // 0
    '
}

get_all_regions_for_gpu() {
    local gpu_type="$1"
    local response
    response=$(get_instance_types)

    echo "$response" | jq -r --arg gpu "$gpu_type" '
        .data[$gpu].regions_with_capacity_available // [] | map(.name) | .[]
    '
}

# ============================================================================
# Interactive Selection Functions
# ============================================================================

scan_local_ssh_keys() {
    local keys=()
    if [[ -d "$HOME/.ssh" ]]; then
        while IFS= read -r -d '' pubkey; do
            keys+=("$pubkey")
        done < <(find "$HOME/.ssh" -maxdepth 1 -name "*.pub" -print0 2>/dev/null)
    fi
    printf '%s\n' "${keys[@]}"
}

generate_ssh_key() {
    local key_name="${1:-cloudkitchens-challenge}"
    local key_path="$HOME/.ssh/$key_name"

    if ! command -v ssh-keygen &> /dev/null; then
        die "ssh-keygen is required but not installed."
    fi

    if [[ -f "$key_path" ]]; then
        log_warn "Key already exists at $key_path"
        echo "$key_path"
        return 0
    fi

    log_info "Generating new SSH key at $key_path..."
    ssh-keygen -t ed25519 -f "$key_path" -N "" -C "$key_name"

    if [[ -f "$key_path" ]]; then
        log_success "SSH key generated: $key_path"
        echo "$key_path"
    else
        die "Failed to generate SSH key"
    fi
}

interactive_select_gpu() {
    log_info "Fetching available GPU types..."
    local response
    response=$(get_instance_types)

    if echo "$response" | jq -e '.error' &>/dev/null; then
        die "API error: $(echo "$response" | jq -r '.error.message // .error')"
    fi

    # Get available GPUs sorted by price (just names)
    local gpu_names_str
    gpu_names_str=$(echo "$response" | jq -r '
        [.data | to_entries[] |
        select(.value.regions_with_capacity_available | length > 0) |
        {
            name: .key,
            price: .value.instance_type.price_cents_per_hour
        }] |
        sort_by(.price) |
        .[].name
    ')

    if [[ -z "$gpu_names_str" ]]; then
        die "No GPUs currently available. Use --wait to wait for availability."
    fi

    # Count GPUs
    local count
    count=$(echo "$gpu_names_str" | wc -l | tr -d ' ')

    echo "" >&2
    echo "Available GPUs (sorted by price):" >&2
    echo "==================================" >&2

    local i=1
    while IFS= read -r name; do
        local gpu_info
        gpu_info=$(echo "$response" | jq -r --arg gpu "$name" '
            .data[$gpu] |
            "\(.instance_type.price_cents_per_hour)\t\(.instance_type.description)\t\(.regions_with_capacity_available | map(.name) | join(", "))"
        ')
        local price_cents description regions
        IFS=$'\t' read -r price_cents description regions <<< "$gpu_info"
        local price_hourly
        price_hourly=$(echo "scale=2; $price_cents / 100" | bc)
        printf "  %2d) %-25s \$%s/hr - %s\n" "$i" "$name" "$price_hourly" "$description" >&2
        printf "      Regions: %s\n" "$regions" >&2
        ((i++))
    done <<< "$gpu_names_str"

    echo "" >&2
    local selection
    selection=$(prompt_selection "Select a GPU" "$count")

    # Get the selected GPU by line number
    echo "$gpu_names_str" | sed -n "${selection}p"
}

interactive_select_region() {
    local gpu_type="$1"

    local regions
    regions=$(get_all_regions_for_gpu "$gpu_type")

    if [[ -z "$regions" ]]; then
        return 0
    fi

    # Count regions
    local count
    count=$(echo "$regions" | wc -l | tr -d ' ')

    # If only one region, return it without prompting
    if [[ "$count" -eq 1 ]]; then
        echo "$regions"
        return 0
    fi

    echo "" >&2
    echo "Available regions for $gpu_type:" >&2
    echo "=================================" >&2

    local i=1
    while IFS= read -r region; do
        printf "  %2d) %s\n" "$i" "$region" >&2
        ((i++))
    done <<< "$regions"

    echo "" >&2
    local selection
    selection=$(prompt_selection "Select a region" "$count")

    # Get the selected region by line number
    echo "$regions" | sed -n "${selection}p"
}

interactive_select_ssh_key() {
    log_info "Fetching registered SSH keys..."
    local registered_keys
    registered_keys=$(get_ssh_keys)

    if echo "$registered_keys" | jq -e '.error' &>/dev/null; then
        die "API error: $(echo "$registered_keys" | jq -r '.error.message // .error')"
    fi

    # Get registered key names as newline-separated string
    local registered_names
    registered_names=$(echo "$registered_keys" | jq -r '.data[].name // empty')

    # Scan local keys
    local local_keys
    local_keys=$(scan_local_ssh_keys)

    # Use a temp file to build options (avoids subshell issues)
    local tmpfile
    tmpfile=$(mktemp)
    trap "rm -f '$tmpfile'" RETURN

    local display_num=1

    echo "" >&2
    echo "SSH Key Selection:" >&2
    echo "==================" >&2

    # Add registered keys
    if [[ -n "$registered_names" ]]; then
        while IFS= read -r name; do
            if [[ -n "$name" ]]; then
                printf "  %2d) %s [registered]\n" "$display_num" "$name" >&2
                echo "registered:${name}:${name}" >> "$tmpfile"
                ((display_num++))
            fi
        done <<< "$registered_names"
    fi

    # Add local keys not already registered
    if [[ -n "$local_keys" ]]; then
        while IFS= read -r key_path; do
            if [[ -n "$key_path" ]]; then
                local key_basename
                key_basename=$(basename "$key_path" .pub)
                # Check if this key is already registered
                if [[ -n "$registered_names" ]] && echo "$registered_names" | grep -qx "$key_basename"; then
                    continue
                fi
                printf "  %2d) %s [local - will be registered]\n" "$display_num" "$key_basename" >&2
                echo "local:${key_basename}:${key_path}" >> "$tmpfile"
                ((display_num++))
            fi
        done <<< "$local_keys"
    fi

    # Add generate new key option
    printf "  %2d) Generate a new SSH key\n" "$display_num" >&2
    echo "generate:generate:" >> "$tmpfile"

    echo "" >&2
    local count=$((display_num))
    local selection
    selection=$(prompt_selection "Select an SSH key" "$count")

    # Get the selected option by line number
    local selected_line
    selected_line=$(sed -n "${selection}p" "$tmpfile")

    local selected_type selected_name selected_value
    IFS=':' read -r selected_type selected_name selected_value <<< "$selected_line"

    case "$selected_type" in
        registered)
            echo "registered:$selected_name"
            ;;
        local)
            echo "local:$selected_name:$selected_value"
            ;;
        generate)
            local key_name="cloudkitchens-challenge"
            echo -en "${YELLOW}[INPUT]${NC} Enter key name (default: $key_name): " >&2
            read -r user_key_name
            if [[ -n "$user_key_name" ]]; then
                key_name="$user_key_name"
            fi
            local key_path
            key_path=$(generate_ssh_key "$key_name")
            echo "local:$key_name:${key_path}.pub"
            ;;
    esac
}

ensure_ssh_key() {
    local key_name="$1"
    local key_file="${2:-}"

    log_info "Checking SSH keys..."
    local existing_keys
    existing_keys=$(get_ssh_keys)

    if echo "$existing_keys" | jq -e '.error' &>/dev/null; then
        die "API error: $(echo "$existing_keys" | jq -r '.error.message // .error')"
    fi

    # Check if key already exists
    if echo "$existing_keys" | jq -e --arg name "$key_name" '.data[] | select(.name == $name)' &>/dev/null; then
        log_info "SSH key '$key_name' already exists"
        return 0
    fi

    # Key doesn't exist, need to create it
    if [[ -z "$key_file" ]]; then
        die "SSH key '$key_name' does not exist and no key file provided"
    fi

    if [[ ! -f "$key_file" ]]; then
        die "SSH key file not found: $key_file"
    fi

    local public_key
    public_key=$(cat "$key_file")

    if ! confirm "SSH key '$key_name' does not exist. Create it from $key_file?"; then
        die "SSH key creation cancelled"
    fi

    log_info "Creating SSH key '$key_name'..."
    local result
    result=$(add_ssh_key "$key_name" "$public_key")

    if echo "$result" | jq -e '.error' &>/dev/null; then
        die "Failed to create SSH key: $(echo "$result" | jq -r '.error.message // .error')"
    fi

    log_success "SSH key created successfully"
}

ensure_filesystem() {
    local fs_name="$1"
    local region="$2"

    log_info "Checking filesystems..."
    local existing_fs
    existing_fs=$(get_filesystems)

    if echo "$existing_fs" | jq -e '.error' &>/dev/null; then
        die "API error: $(echo "$existing_fs" | jq -r '.error.message // .error')"
    fi

    # Check if filesystem exists
    local fs_info
    fs_info=$(echo "$existing_fs" | jq --arg name "$fs_name" '.data[] | select(.name == $name)')

    if [[ -n "$fs_info" ]]; then
        local fs_region
        fs_region=$(echo "$fs_info" | jq -r '.region.name')

        if [[ "$fs_region" != "$region" ]]; then
            die "Filesystem '$fs_name' exists but in region '$fs_region', not '$region'. Filesystems cannot be transferred between regions."
        fi

        log_info "Filesystem '$fs_name' already exists in region '$region'"
        return 0
    fi

    # Filesystem doesn't exist, create it
    if ! confirm "Filesystem '$fs_name' does not exist. Create it in region '$region'?"; then
        die "Filesystem creation cancelled"
    fi

    log_info "Creating filesystem '$fs_name' in region '$region'..."
    local result
    result=$(create_filesystem "$fs_name" "$region")

    if echo "$result" | jq -e '.error' &>/dev/null; then
        die "Failed to create filesystem: $(echo "$result" | jq -r '.error.message // .error')"
    fi

    log_success "Filesystem created successfully"
}

wait_for_availability() {
    local gpu_type="$1"
    local region="${2:-}"
    local start_time
    start_time=$(date +%s)

    log_info "Waiting for GPU availability..."
    log_info "GPU type: $gpu_type"
    [[ -n "$region" ]] && log_info "Region: $region"
    log_info "Poll interval: ${POLL_INTERVAL}s, Max wait: ${MAX_WAIT_TIME}s"
    echo ""

    while true; do
        local current_time
        current_time=$(date +%s)
        local elapsed=$((current_time - start_time))

        if [[ $elapsed -ge $MAX_WAIT_TIME ]]; then
            die "Timeout waiting for GPU availability after ${MAX_WAIT_TIME}s"
        fi

        if [[ -n "$region" ]]; then
            # Check specific region
            if find_gpu_in_region "$gpu_type" "$region"; then
                log_success "GPU $gpu_type is now available in $region!"
                echo "$region"
                return 0
            fi
        else
            # Check any region
            local available_region
            available_region=$(find_gpu_any_region "$gpu_type")
            if [[ -n "$available_region" ]]; then
                log_success "GPU $gpu_type is now available in $available_region!"
                echo "$available_region"
                return 0
            fi
        fi

        local remaining=$((MAX_WAIT_TIME - elapsed))
        log_info "$(date '+%Y-%m-%d %H:%M:%S') - Not available yet. Checking again in ${POLL_INTERVAL}s (${remaining}s remaining)..."
        sleep "$POLL_INTERVAL"
    done
}

wait_for_instance_ready() {
    local instance_id="$1"
    local max_wait=600  # 10 minutes
    local start_time
    start_time=$(date +%s)

    log_info "Waiting for instance $instance_id to be ready..."

    while true; do
        local current_time
        current_time=$(date +%s)
        local elapsed=$((current_time - start_time))

        if [[ $elapsed -ge $max_wait ]]; then
            log_warn "Timeout waiting for instance to be ready. It may still be starting."
            return 1
        fi

        local instance_info
        instance_info=$(get_instance "$instance_id")

        local status
        status=$(echo "$instance_info" | jq -r '.data.status // "unknown"')

        if [[ "$status" == "active" ]]; then
            log_success "Instance is ready!"
            return 0
        fi

        log_info "Instance status: $status - waiting..."
        sleep 10
    done
}

run_init_script() {
    local ip_address="$1"
    local init_script="$2"
    local ssh_key_file="${3:-}"

    if [[ ! -f "$init_script" ]]; then
        die "Init script not found: $init_script"
    fi

    log_info "Running init script on instance..."

    # Build SSH options
    local ssh_opts=(-o "StrictHostKeyChecking=no" -o "UserKnownHostsFile=/dev/null" -o "ConnectTimeout=30")

    # Add identity file if provided
    if [[ -n "$ssh_key_file" ]]; then
        # Convert .pub to private key path if needed
        local private_key="${ssh_key_file%.pub}"
        if [[ -f "$private_key" ]]; then
            ssh_opts+=(-i "$private_key")
        fi
    fi

    # Wait a bit for SSH to be ready (instance might be active but SSH not yet listening)
    log_info "Waiting for SSH to be ready..."
    local ssh_ready=false
    for i in {1..30}; do
        if ssh "${ssh_opts[@]}" -o "BatchMode=yes" "ubuntu@${ip_address}" "echo ready" &>/dev/null; then
            ssh_ready=true
            break
        fi
        log_info "SSH not ready yet, attempt $i/30..."
        sleep 10
    done

    if [[ "$ssh_ready" != "true" ]]; then
        log_warn "Could not connect via SSH after 5 minutes. Init script not executed."
        log_warn "You can manually run it with: ssh ubuntu@$ip_address < $init_script"
        return 1
    fi

    # Copy and execute the init script
    log_info "Copying init script to instance..."
    scp "${ssh_opts[@]}" "$init_script" "ubuntu@${ip_address}:/tmp/init-script.sh"

    log_info "Executing init script..."
    ssh "${ssh_opts[@]}" "ubuntu@${ip_address}" "chmod +x /tmp/init-script.sh && /tmp/init-script.sh"

    local exit_code=$?
    if [[ $exit_code -eq 0 ]]; then
        log_success "Init script completed successfully"
    else
        log_warn "Init script exited with code $exit_code"
    fi

    return $exit_code
}

provision_gpu() {
    local gpu_type="$1"
    local region="$2"
    local ssh_key_name="$3"
    local ssh_key_file="${4:-}"
    local instance_name="${5:-}"
    local filesystem_name="${6:-}"
    local wait_for_avail="${7:-false}"
    local init_script="${8:-}"

    # Ensure SSH key exists
    ensure_ssh_key "$ssh_key_name" "$ssh_key_file"

    # Check GPU availability
    log_info "Checking availability of $gpu_type..."

    local target_region="$region"

    if [[ -n "$region" ]]; then
        # Specific region requested
        if ! find_gpu_in_region "$gpu_type" "$region"; then
            if [[ "$wait_for_avail" == "true" ]]; then
                target_region=$(wait_for_availability "$gpu_type" "$region")
            else
                die "GPU $gpu_type is not available in region $region. Use --wait to wait for availability."
            fi
        fi
    else
        # Any region
        target_region=$(find_gpu_any_region "$gpu_type")
        if [[ -z "$target_region" ]]; then
            if [[ "$wait_for_avail" == "true" ]]; then
                target_region=$(wait_for_availability "$gpu_type")
            else
                die "GPU $gpu_type is not available in any region. Use --wait to wait for availability."
            fi
        fi
    fi

    log_info "Target region: $target_region"

    # Handle filesystem
    local fs_names="[]"
    if [[ -n "$filesystem_name" ]]; then
        ensure_filesystem "$filesystem_name" "$target_region"
        fs_names="[\"$filesystem_name\"]"
    fi

    # Get pricing info
    local price_cents
    price_cents=$(get_gpu_price "$gpu_type")
    local price_hourly
    price_hourly=$(echo "scale=2; $price_cents / 100" | bc)
    local price_daily
    price_daily=$(echo "scale=2; $price_hourly * 24" | bc)

    # Confirmation
    echo ""
    echo "=========================================="
    echo "GPU Provisioning Summary"
    echo "=========================================="
    echo "Instance Type: $gpu_type"
    echo "Region: $target_region"
    echo "SSH Key: $ssh_key_name"
    [[ -n "$instance_name" ]] && echo "Instance Name: $instance_name"
    [[ -n "$filesystem_name" ]] && echo "Filesystem: $filesystem_name"
    [[ -n "$init_script" ]] && echo "Init Script: $init_script"
    echo ""
    echo "Estimated Cost:"
    echo "  Hourly:  \$${price_hourly}"
    echo "  Daily:   \$${price_daily}"
    echo "=========================================="
    echo ""

    if ! confirm "Proceed with instance launch?"; then
        die "Launch cancelled by user"
    fi

    # Launch instance
    log_info "Launching instance..."
    local ssh_key_array="[\"$ssh_key_name\"]"
    local result
    result=$(launch_instance "$gpu_type" "$target_region" "$ssh_key_array" "$instance_name" "$fs_names")

    if echo "$result" | jq -e '.error' &>/dev/null; then
        die "Failed to launch instance: $(echo "$result" | jq -r '.error.message // .error')"
    fi

    local instance_id
    instance_id=$(echo "$result" | jq -r '.data.instance_ids[0]')

    if [[ -z "$instance_id" ]] || [[ "$instance_id" == "null" ]]; then
        die "Failed to get instance ID from response: $result"
    fi

    log_success "Instance launched! ID: $instance_id"

    # Wait for instance to be ready
    wait_for_instance_ready "$instance_id"

    # Get instance details
    local instance_info
    instance_info=$(get_instance "$instance_id")

    local ip_address
    ip_address=$(echo "$instance_info" | jq -r '.data.ip // "pending"')

    # Run init script if provided
    if [[ -n "$init_script" ]] && [[ "$ip_address" != "pending" ]]; then
        run_init_script "$ip_address" "$init_script" "$ssh_key_file"
    fi

    echo ""
    echo "=========================================="
    echo "Instance Details"
    echo "=========================================="
    echo "Instance ID: $instance_id"
    echo "IP Address: $ip_address"
    echo "Status: $(echo "$instance_info" | jq -r '.data.status')"
    [[ -n "$filesystem_name" ]] && echo "Filesystem mounted at: /lambda/nfs/$filesystem_name"
    echo ""
    echo "Connect with:"
    echo "  ssh ubuntu@$ip_address"
    echo "=========================================="
}

provision_cheapest() {
    local ssh_key_name="$1"
    local ssh_key_file="${2:-}"
    local instance_name="${3:-}"
    local filesystem_name="${4:-}"
    local init_script="${5:-}"

    log_info "Finding cheapest available GPU..."

    local cheapest
    cheapest=$(find_cheapest_gpu)

    if [[ -z "$cheapest" ]]; then
        die "No GPUs currently available"
    fi

    local gpu_type region price_cents description
    IFS=$'\t' read -r gpu_type region price_cents description <<< "$cheapest"

    local price_hourly
    price_hourly=$(echo "scale=2; $price_cents / 100" | bc)

    log_info "Cheapest available: $gpu_type at \$${price_hourly}/hr in $region"
    log_info "Description: $description"
    echo ""

    if ! confirm "Provision this GPU?"; then
        die "Cancelled by user"
    fi

    provision_gpu "$gpu_type" "$region" "$ssh_key_name" "$ssh_key_file" "$instance_name" "$filesystem_name" "false" "$init_script"
}

cleanup_all() {
    log_warn "This will terminate ALL instances and delete ALL filesystems!"
    log_warn "This action is IRREVERSIBLE and may result in DATA LOSS!"
    echo ""

    # Get instances
    log_info "Fetching instances..."
    local instances_response
    instances_response=$(get_instances)

    if echo "$instances_response" | jq -e '.error' &>/dev/null; then
        die "API error: $(echo "$instances_response" | jq -r '.error.message // .error')"
    fi

    local instance_count
    instance_count=$(echo "$instances_response" | jq '.data | length')

    # Get filesystems
    log_info "Fetching filesystems..."
    local filesystems_response
    filesystems_response=$(get_filesystems)

    if echo "$filesystems_response" | jq -e '.error' &>/dev/null; then
        die "API error: $(echo "$filesystems_response" | jq -r '.error.message // .error')"
    fi

    local filesystem_count
    filesystem_count=$(echo "$filesystems_response" | jq '.data | length')

    # Show what will be deleted
    echo ""
    echo "=========================================="
    echo "Resources to be deleted:"
    echo "=========================================="
    echo ""

    if [[ "$instance_count" -gt 0 ]]; then
        echo "INSTANCES ($instance_count):"
        echo "$instances_response" | jq -r '.data[] | "  - \(.id) (\(.name // "unnamed")) - \(.instance_type.name) in \(.region.name)"'
        echo ""
    else
        echo "INSTANCES: None"
        echo ""
    fi

    if [[ "$filesystem_count" -gt 0 ]]; then
        echo "FILESYSTEMS ($filesystem_count):"
        echo "$filesystems_response" | jq -r '.data[] | "  - \(.id) (\(.name)) in \(.region.name)"'
        echo ""
    else
        echo "FILESYSTEMS: None"
        echo ""
    fi

    echo "=========================================="
    echo ""

    if [[ "$instance_count" -eq 0 ]] && [[ "$filesystem_count" -eq 0 ]]; then
        log_info "Nothing to clean up."
        return 0
    fi

    # Require explicit confirmation
    if [[ "$AUTO_MODE" != "true" ]]; then
        echo -en "${RED}[DANGER]${NC} Type 'yes' to confirm deletion: "
        read -r response
        if [[ "$response" != "yes" ]]; then
            die "Cleanup cancelled. You must type 'yes' to confirm."
        fi
    else
        log_warn "Auto-mode enabled - proceeding with cleanup"
    fi

    # Terminate instances first (filesystems must be detached)
    if [[ "$instance_count" -gt 0 ]]; then
        log_info "Terminating $instance_count instance(s)..."

        local instance_ids
        instance_ids=$(echo "$instances_response" | jq -r '.data[].id')

        for instance_id in $instance_ids; do
            log_info "Terminating instance $instance_id..."
            local result
            result=$(terminate_instance "$instance_id")
            if echo "$result" | jq -e '.error' &>/dev/null; then
                log_error "Failed to terminate $instance_id: $(echo "$result" | jq -r '.error.message // .error')"
            else
                log_success "Terminated $instance_id"
            fi
        done

        # Wait for instances to terminate before deleting filesystems
        log_info "Waiting for instances to terminate (30 seconds)..."
        sleep 30
    fi

    # Delete filesystems
    local fs_delete_failures=0
    if [[ "$filesystem_count" -gt 0 ]]; then
        log_info "Deleting $filesystem_count filesystem(s)..."

        local filesystem_ids
        filesystem_ids=$(echo "$filesystems_response" | jq -r '.data[].id')

        for filesystem_id in $filesystem_ids; do
            local fs_name
            fs_name=$(echo "$filesystems_response" | jq -r --arg id "$filesystem_id" '.data[] | select(.id == $id) | .name')
            log_info "Deleting filesystem $fs_name ($filesystem_id)..."
            local result
            result=$(delete_filesystem "$filesystem_id")
            if echo "$result" | jq -e '.error' &>/dev/null; then
                log_error "Failed to delete $fs_name: $(echo "$result" | jq -r '.error.message // .error')"
                ((fs_delete_failures++))
            else
                log_success "Deleted $fs_name"
            fi
        done
    fi

    echo ""
    if [[ "$fs_delete_failures" -gt 0 ]]; then
        log_warn "Some filesystems could not be deleted via API."
        log_warn "You may need to delete them manually via the Lambda Cloud console:"
        log_warn "  https://cloud.lambdalabs.com/file-systems"
        echo ""
    fi
    log_success "Cleanup complete!"
}

# ============================================================================
# CLI Interface
# ============================================================================

usage() {
    cat << 'EOF'
Lambda Labs GPU Provisioning Script

USAGE:
    provision-gpu.sh <command> [options]

COMMANDS:
    list                List available GPU types
    list-all           List all GPU types (including unavailable)
    provision          Provision a specific GPU
    cheapest           Provision the cheapest available GPU
    filesystems        List existing filesystems
    ssh-keys           List existing SSH keys
    instances          List running instances
    terminate          Terminate an instance
    cleanup            Terminate ALL instances and delete ALL filesystems

OPTIONS:
    -a, --api-key-file PATH Path to file containing API key
    -g, --gpu TYPE          GPU instance type (e.g., gpu_1x_a100)
    -r, --region REGION     Target region (e.g., us-west-1)
    -k, --ssh-key NAME      SSH key name (required for provision)
    -f, --ssh-key-file PATH Path to public SSH key file (for creating new key)
    -n, --name NAME         Instance name (optional)
    -s, --filesystem NAME   Filesystem name (creates if doesn't exist)
    -i, --init-script PATH  Script to run on instance after provisioning
    -w, --wait              Wait for GPU availability
    -y, --yes               Auto-confirm all prompts (auto mode, disables interactive)
    --poll-interval SECS    Seconds between availability checks (default: 60)
    --max-wait SECS         Maximum wait time in seconds (default: 86400)
    -h, --help              Show this help message

ENVIRONMENT:
    LAMBDA_API_KEY          Your Lambda Labs API key (or use --api-key-file)

INTERACTIVE MODE:
    When run in an interactive terminal without required options, the script
    will guide you through GPU and SSH key selection:

    ./provision-gpu.sh provision          # Interactive GPU + SSH key selection
    ./provision-gpu.sh provision -g gpu   # Interactive SSH key selection only
    ./provision-gpu.sh provision -k key   # Interactive GPU selection only
    ./provision-gpu.sh cheapest           # Interactive SSH key selection

    Interactive mode supports:
    - Selecting from available GPUs (sorted by price)
    - Selecting from registered Lambda Labs SSH keys
    - Using local ~/.ssh/*.pub keys (auto-registered on use)
    - Generating new SSH keys (default name: cloudkitchens-challenge)
    - Selecting from available regions when multiple are available

    Note: Interactive mode requires a terminal (stdin must be a tty).
    When piped or in auto mode (-y), all required options must be provided.

EXAMPLES:
    # Interactive provisioning (terminal required)
    ./provision-gpu.sh provision

    # List available GPUs (using env var)
    export LAMBDA_API_KEY="your-key"
    ./provision-gpu.sh list

    # List available GPUs (using key file)
    ./provision-gpu.sh list -a ~/lambda-api-key.txt

    # Provision specific GPU in specific region
    ./provision-gpu.sh provision -g gpu_1x_a100 -r us-west-1 -k my-key

    # Provision GPU in any available region
    ./provision-gpu.sh provision -g gpu_1x_a100 -k my-key

    # Provision cheapest available GPU
    ./provision-gpu.sh cheapest -k my-key

    # Wait for GPU availability and provision
    ./provision-gpu.sh provision -g gpu_1x_h100 -k my-key --wait

    # Create SSH key from file and provision
    ./provision-gpu.sh provision -g gpu_1x_a100 -k my-new-key -f ~/.ssh/id_rsa.pub

    # Provision with filesystem (creates if doesn't exist)
    ./provision-gpu.sh provision -g gpu_1x_a100 -k my-key -s my-storage

    # Provision with init script (runs after instance is ready)
    ./provision-gpu.sh provision -g gpu_1x_a100 -k my-key -i setup.sh

    # Auto-confirm all prompts (non-interactive, all options required)
    ./provision-gpu.sh provision -g gpu_1x_a100 -k my-key -y

    # Terminate an instance
    ./provision-gpu.sh terminate <instance-id>

    # Cleanup: terminate all instances and delete all filesystems
    ./provision-gpu.sh cleanup

EOF
    exit 0
}

main() {
    check_jq

    # Default values
    AUTO_MODE="false"
    local api_key_file=""
    local gpu_type=""
    local region=""
    local ssh_key_name=""
    local ssh_key_file=""
    local instance_name=""
    local filesystem_name=""
    local init_script=""
    local wait_for_avail="false"
    local command=""

    # Parse arguments (first pass for help and api key file)
    local args=("$@")
    for ((i=0; i<${#args[@]}; i++)); do
        case "${args[$i]}" in
            -h|--help)
                usage
                ;;
            -a|--api-key-file)
                api_key_file="${args[$((i+1))]}"
                ;;
        esac
    done

    # Show help if no arguments provided
    if [[ ${#args[@]} -eq 0 ]]; then
        usage
    fi

    # Load API key from file if specified
    if [[ -n "$api_key_file" ]]; then
        load_api_key_from_file "$api_key_file"
    fi

    check_api_key

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            list|list-all|provision|cheapest|filesystems|ssh-keys|instances|terminate|cleanup)
                command="$1"
                shift
                ;;
            -a|--api-key-file)
                # Already handled above
                shift 2
                ;;
            -g|--gpu)
                gpu_type="$2"
                shift 2
                ;;
            -r|--region)
                region="$2"
                shift 2
                ;;
            -k|--ssh-key)
                ssh_key_name="$2"
                shift 2
                ;;
            -f|--ssh-key-file)
                ssh_key_file="$2"
                shift 2
                ;;
            -n|--name)
                instance_name="$2"
                shift 2
                ;;
            -s|--filesystem)
                filesystem_name="$2"
                shift 2
                ;;
            -i|--init-script)
                init_script="$2"
                shift 2
                ;;
            -w|--wait)
                wait_for_avail="true"
                shift
                ;;
            -y|--yes)
                AUTO_MODE="true"
                shift
                ;;
            --poll-interval)
                POLL_INTERVAL="$2"
                shift 2
                ;;
            --max-wait)
                MAX_WAIT_TIME="$2"
                shift 2
                ;;
            -h|--help)
                usage
                ;;
            *)
                # Check if it's an instance ID for terminate command
                if [[ "$command" == "terminate" ]]; then
                    instance_name="$1"
                fi
                shift
                ;;
        esac
    done

    # Execute command
    case "$command" in
        list)
            list_available_gpus
            ;;
        list-all)
            list_all_gpus
            ;;
        provision)
            # Interactive GPU selection if not provided
            if [[ -z "$gpu_type" ]]; then
                if is_interactive && [[ "$AUTO_MODE" != "true" ]]; then
                    gpu_type=$(interactive_select_gpu)
                else
                    die "GPU type is required. Use -g or --gpu option. (Interactive mode requires a terminal)"
                fi
            fi

            # Interactive region selection if not specified and multiple available
            if [[ -z "$region" ]] && is_interactive && [[ "$AUTO_MODE" != "true" ]]; then
                region=$(interactive_select_region "$gpu_type")
            fi

            # Interactive SSH key selection if not provided
            if [[ -z "$ssh_key_name" ]]; then
                if is_interactive && [[ "$AUTO_MODE" != "true" ]]; then
                    local ssh_selection
                    ssh_selection=$(interactive_select_ssh_key)

                    local ssh_type ssh_name ssh_path
                    IFS=':' read -r ssh_type ssh_name ssh_path <<< "$ssh_selection"

                    ssh_key_name="$ssh_name"
                    if [[ "$ssh_type" == "local" ]]; then
                        ssh_key_file="$ssh_path"
                    fi
                else
                    die "SSH key name is required. Use -k or --ssh-key option. (Interactive mode requires a terminal)"
                fi
            fi

            provision_gpu "$gpu_type" "$region" "$ssh_key_name" "$ssh_key_file" "$instance_name" "$filesystem_name" "$wait_for_avail" "$init_script"
            ;;
        cheapest)
            # Interactive SSH key selection if not provided
            if [[ -z "$ssh_key_name" ]]; then
                if is_interactive && [[ "$AUTO_MODE" != "true" ]]; then
                    local ssh_selection
                    ssh_selection=$(interactive_select_ssh_key)

                    local ssh_type ssh_name ssh_path
                    IFS=':' read -r ssh_type ssh_name ssh_path <<< "$ssh_selection"

                    ssh_key_name="$ssh_name"
                    if [[ "$ssh_type" == "local" ]]; then
                        ssh_key_file="$ssh_path"
                    fi
                else
                    die "SSH key name is required. Use -k or --ssh-key option. (Interactive mode requires a terminal)"
                fi
            fi

            provision_cheapest "$ssh_key_name" "$ssh_key_file" "$instance_name" "$filesystem_name" "$init_script"
            ;;
        filesystems)
            log_info "Listing filesystems..."
            get_filesystems | jq -r '.data[] | "\(.name)\t\(.region.name)\t\(.bytes_used // 0) bytes used"' | column -t -s $'\t'
            ;;
        ssh-keys)
            log_info "Listing SSH keys..."
            get_ssh_keys | jq -r '.data[] | "\(.name)\t\(.id)"' | column -t -s $'\t'
            ;;
        instances)
            log_info "Listing instances..."
            get_instances | jq -r '.data[] | "\(.id)\t\(.name // "unnamed")\t\(.instance_type.name)\t\(.region.name)\t\(.status)\t\(.ip // "no-ip")"' | column -t -s $'\t'
            ;;
        terminate)
            if [[ -z "$instance_name" ]]; then
                die "Instance ID is required for terminate command."
            fi
            if ! confirm "Terminate instance $instance_name?"; then
                die "Terminate cancelled"
            fi
            log_info "Terminating instance $instance_name..."
            result=$(terminate_instance "$instance_name")
            if echo "$result" | jq -e '.error' &>/dev/null; then
                die "Failed to terminate: $(echo "$result" | jq -r '.error.message // .error')"
            fi
            log_success "Instance terminated"
            ;;
        cleanup)
            cleanup_all
            ;;
        "")
            usage
            ;;
        *)
            die "Unknown command: $command"
            ;;
    esac
}

main "$@"
