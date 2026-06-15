#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# GCP Setup for Jenkins Chat Approval Bridge
#
# Automates: service account creation, IAM roles, secrets, key generation
#
# Usage:
#   ./gcp-setup.sh
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - Permission to create service accounts and manage IAM in the project
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_ok() { echo -e "${GREEN}✓${NC} $1"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $1"; }
log_err() { echo -e "${RED}✗${NC} $1"; }

# Configuration
GCP_PROJECT_ID="${GCP_PROJECT_ID:-cred2tech}"
GCP_REGION="${GCP_REGION:-asia-south1}"
SA_NAME="chat-approver"
SA_DISPLAY_NAME="Jenkins Chat Approval Bridge"
OUTPUT_DIR="${OUTPUT_DIR:-.}"

echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║         GCP Setup for Jenkins Chat Approval Bridge                         ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""

# ── 1. Validate Project ────────────────────────────────────────────────────────
log_info "Verifying GCP project..."
if ! gcloud projects describe "$GCP_PROJECT_ID" &>/dev/null; then
  log_err "Project not found: $GCP_PROJECT_ID"
  exit 1
fi
PROJECT_NUMBER=$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')
log_ok "Project: $GCP_PROJECT_ID (number: $PROJECT_NUMBER)"

# ── 2. Create Service Account ──────────────────────────────────────────────────
log_info "Creating service account..."
SA_EMAIL="${SA_NAME}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

if gcloud iam service-accounts describe "$SA_EMAIL" --project="$GCP_PROJECT_ID" &>/dev/null; then
  log_warn "Service account already exists: $SA_EMAIL"
else
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="$SA_DISPLAY_NAME" \
    --project="$GCP_PROJECT_ID"
  log_ok "Service account created: $SA_EMAIL"
fi

# ── 3. Grant IAM Roles ─────────────────────────────────────────────────────────
log_info "Granting IAM roles..."

ROLES=(
  "roles/run.admin"
  "roles/artifactregistry.writer"
  "roles/secretmanager.secretAccessor"
  "roles/iam.serviceAccountUser"
)

for role in "${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$role" \
    --condition=None \
    --quiet 2>/dev/null || log_warn "Role $role binding may already exist"
done
log_ok "IAM roles granted"

# ── 4. Enable Required APIs ────────────────────────────────────────────────────
log_info "Enabling required APIs..."
APIS=("run.googleapis.com" "secretmanager.googleapis.com" "artifactregistry.googleapis.com")
for api in "${APIS[@]}"; do
  gcloud services enable "$api" --project="$GCP_PROJECT_ID" 2>/dev/null || log_warn "API may already be enabled: $api"
done
log_ok "APIs enabled"

# ── 5. Create Service Account Key ──────────────────────────────────────────────
log_info "Creating service account key..."
KEY_FILE="${OUTPUT_DIR}/chat-approver-sa-key.json"

# Delete old key if it exists
gcloud iam service-accounts keys list \
  --iam-account="$SA_EMAIL" \
  --project="$GCP_PROJECT_ID" \
  --filter='-disabled' \
  --format='value(name)' | grep -v 'type.googleapis.com/google.iam.admin.v1.ServiceAccountKey.USER_MANAGED' > /dev/null && \
  log_warn "Multiple keys exist; creating additional key" || true

gcloud iam service-accounts keys create "$KEY_FILE" \
  --iam-account="$SA_EMAIL" \
  --project="$GCP_PROJECT_ID"

chmod 600 "$KEY_FILE"
log_ok "Service account key saved: $KEY_FILE"

# ── 6. Create/Update GCP Secrets ───────────────────────────────────────────────
log_info "Setting up GCP Secrets..."

read -sp "Enter APPROVAL_SHARED_SECRET (Jenkins <-> Chat bridge): " SHARED_SECRET
echo ""
echo -n "$SHARED_SECRET" > "${OUTPUT_DIR}/.secret-approval"

read -sp "Enter JENKINS_BOT_TOKEN (Jenkins API token): " JENKINS_BOT_TOKEN
echo ""
echo -n "$JENKINS_BOT_TOKEN" > "${OUTPUT_DIR}/.secret-jenkins-bot"

# Create or update secrets
if gcloud secrets describe chat-approval-secret --project="$GCP_PROJECT_ID" &>/dev/null; then
  log_warn "Secret chat-approval-secret already exists; adding new version"
  gcloud secrets versions add chat-approval-secret \
    --data-file="${OUTPUT_DIR}/.secret-approval" \
    --project="$GCP_PROJECT_ID"
else
  gcloud secrets create chat-approval-secret \
    --replication-policy="automatic" \
    --data-file="${OUTPUT_DIR}/.secret-approval" \
    --project="$GCP_PROJECT_ID"
fi
log_ok "Secret created: chat-approval-secret"

if gcloud secrets describe jenkins-bot-token --project="$GCP_PROJECT_ID" &>/dev/null; then
  log_warn "Secret jenkins-bot-token already exists; adding new version"
  gcloud secrets versions add jenkins-bot-token \
    --data-file="${OUTPUT_DIR}/.secret-jenkins-bot" \
    --project="$GCP_PROJECT_ID"
else
  gcloud secrets create jenkins-bot-token \
    --replication-policy="automatic" \
    --data-file="${OUTPUT_DIR}/.secret-jenkins-bot" \
    --project="$GCP_PROJECT_ID"
fi
log_ok "Secret created: jenkins-bot-token"

# Grant service account access to secrets
gcloud secrets add-iam-policy-binding chat-approval-secret \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" \
  --project="$GCP_PROJECT_ID" \
  --quiet 2>/dev/null || true

gcloud secrets add-iam-policy-binding jenkins-bot-token \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor" \
  --project="$GCP_PROJECT_ID" \
  --quiet 2>/dev/null || true
log_ok "Secrets accessible to service account"

# ── 7. Cleanup Temp Files ──────────────────────────────────────────────────────
rm -f "${OUTPUT_DIR}/.secret-approval" "${OUTPUT_DIR}/.secret-jenkins-bot"

# ── 8. Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                        Setup Complete! ✓                                   ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "📋 Configuration Summary:"
echo "   GCP Project:         $GCP_PROJECT_ID"
echo "   Project Number:      $PROJECT_NUMBER (← use as CHAT_AUDIENCE)"
echo "   Service Account:     $SA_EMAIL"
echo "   Key File:            $KEY_FILE"
echo "   Region:              $GCP_REGION"
echo ""
echo "Next Steps:"
echo "   1. Upload $KEY_FILE to Jenkins as 'gcp-sa-key-json' credential"
echo "   2. Create Jenkins pipeline job (see QUICK_START.md)"
echo "   3. Update Jenkinsfile with:"
echo "      - CHAT_SPACE=spaces/XXXXX (from Google Chat API config)"
echo "      - CHAT_AUDIENCE=$PROJECT_NUMBER"
echo "      - Other values (JENKINS_URL, APPROVERS_GROUP, etc.)"
echo ""
echo "⚠️  Store $KEY_FILE securely — treat it like a password!"
echo ""
