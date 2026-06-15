# Jenkins Chat Approval - Complete Deployment Guide

**Status:** Ready for deployment  
**Deliverables:** Jenkinsfile, setup scripts, documentation  
**Effort:** ~15 minutes to complete  

---

## Overview

This guide takes you from zero to production approval of all three services via **Google Chat**, **Email**, or **Jenkins UI** — with a single approval that works across all channels.

```
┌─────────────────────────────────────────────────────────────────┐
│ Production Deployment Approval — Three Channels                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1️⃣  Jenkins UI Button         (unchanged)                      │
│  2️⃣  Email Deep-Link           (existing)                       │
│  3️⃣  Google Chat Card          (NEW — this service)            │
│                                                                 │
│  All three gate the SAME input step. Approvers team:           │
│  approvers@cred2tech.com drives access everywhere.             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## What's Included

| File | Purpose |
|------|---------|
| `Jenkinsfile` | CI/CD pipeline: checkout → test → build → deploy to Cloud Run |
| `QUICK_START.md` | 5-minute setup if you just want it working |
| `SETUP_CHECKLIST.md` | Detailed checklist for every step |
| `JENKINS_SETUP.md` | Jenkins-specific config + troubleshooting |
| `gcp-setup.sh` | Automates GCP service account + IAM setup |
| `index.js` | The service itself (Node.js/Express) |
| `Dockerfile` | Containerization |

---

## Quick Decision Tree

**Choose your path:**

1. **I want it running NOW** → Read `QUICK_START.md` (5 min)
2. **I want step-by-step with full detail** → Follow `SETUP_CHECKLIST.md` (15 min)
3. **I want to automate GCP setup** → Run `gcp-setup.sh`, then Jenkins config (10 min)
4. **I need to troubleshoot** → See `JENKINS_SETUP.md` → **Troubleshooting** section

---

## Estimated Timeline

| Phase | Time | What Happens |
|-------|------|--------------|
| **GCP Setup** | 5 min | Service account, IAM roles, secrets created |
| **Jenkins Config** | 3 min | Add credentials, create pipeline job |
| **First Build** | 2 min | Tests run, Docker image built, approval gate pauses |
| **Approve & Deploy** | 2 min | Deploy to Cloud Run, health checks pass |
| **Integration** | 2 min | Update other Jenkinsfiles with Chat approval URL |
| **Total** | ~15 min | Everything working |

---

## Getting Started

### Path A: Automated GCP Setup (Recommended)

```bash
cd jenkins-chat-approval

# 1. Run the setup script (creates everything on GCP)
./gcp-setup.sh

# This will:
# ✓ Create service account (chat-approver@cred2tech.iam...)
# ✓ Grant required IAM roles
# ✓ Create secrets in Secret Manager
# ✓ Generate service account key
# ✓ Output the PROJECT_NUMBER you'll need

# 2. Output shows:
#    - Key file location (upload to Jenkins as gcp-sa-key-json)
#    - Project Number (use as CHAT_AUDIENCE in Jenkinsfile)
```

Then jump to **Jenkins Configuration** below.

### Path B: Manual GCP Setup

Follow **SETUP_CHECKLIST.md** → **Phase 1** for detailed commands.

---

## Jenkins Configuration

### 1. Add GCP Credentials

1. Jenkins → **Manage Jenkins** → **Credentials** → **System** → **Global Credentials**
2. **Add Credentials** → **File**
   - Upload the key file from `gcp-setup.sh` output
   - **Credential ID:** `gcp-sa-key-json`
3. **Create**

### 2. Create Pipeline Job

1. Jenkins → **New Item**
2. **Name:** `jenkins-chat-approval`
3. **Type:** Pipeline
4. Under **Pipeline** section:
   - **Definition:** Pipeline script from SCM
   - **SCM:** Git
   - **Repository URL:** `https://github.com/adarshcred2tech/jenkins-chat-approval.git`
   - **Credentials:** `github-cred2tech` (already exists)
   - **Branch:** `*/main`
   - **Script Path:** `Jenkinsfile`
5. **Save**

### 3. Update Jenkinsfile with Your Values

Edit `jenkins-chat-approval/Jenkinsfile`, line ~180:

**Before:**
```groovy
--set-env-vars CHAT_SPACE=spaces/AAAA...,CHAT_AUDIENCE=123456789012,...
```

**After:**
```groovy
--set-env-vars CHAT_SPACE=spaces/YOUR_ACTUAL_SPACE_ID,CHAT_AUDIENCE=YOUR_PROJECT_NUMBER,...
```

| Value | Where to Find |
|-------|---------------|
| `CHAT_SPACE` | Google Chat API config for your app → `spaces/XXXXX` |
| `CHAT_AUDIENCE` | Output of `gcp-setup.sh` (your GCP project number) |
| `JENKINS_URL` | Your Jenkins URL: `https://jenkins.cred2tech.com` |
| `JENKINS_BOT_USER` | Jenkins user: `chat-approver-bot` |
| `APPROVERS_GROUP` | Your Workspace group: `approvers@cred2tech.com` |
| `DIRECTORY_IMPERSONATE_USER` | A Workspace admin: `it-admin@cred2tech.com` |

### 4. Commit & Push

```bash
git add jenkins-chat-approval/Jenkinsfile
git commit -m "Update jenkins-chat-approval with GCP + Jenkins values"
git push origin main
```

---

## First Deployment

### Step 1: Trigger Build

In Jenkins, go to the `jenkins-chat-approval` job → **Build Now**

Watch the stages:
- ✓ **Checkout** (clones repo)
- ✓ **Validate Branch** (checks it's `main`)
- ✓ **Install Dependencies** (`npm ci`)
- ✓ **Lint** (optional)
- ✓ **Test** (`npm test`)
- ✓ **Build Docker Image** (creates image)
- ⏸️ **Approval Gate** (email sent, pauses here)

### Step 2: Approve

1. Check your email for approval link
2. Click the link (or Jenkins UI)
3. Review the changes
4. Click **Deploy to Production**

Watch remaining stages:
- ✓ **Push Image** (to Artifact Registry)
- ✓ **Deploy to Cloud Run** (service deployed)
- ✓ **Health Check** (verifies it's responding)
- ✓ **Smoke Tests** (basic checks)
- ✓ **Success** (build complete)

### Step 3: Get the Cloud Run URL

From the Jenkins build output, find:
```
Deployed to: https://jenkins-chat-approval-XXXXX-as.a.run.app
```

Save this URL — you'll use it to enable Chat approvals in other pipelines.

---

## Enable Chat Approvals in Other Pipelines

### Update nestjs-backend/Jenkinsfile

Find the `environment {}` block at the top and add:

```groovy
CHAT_APPROVAL_URL = 'https://jenkins-chat-approval-XXXXX-as.a.run.app/notify'
```

(Replace `XXXXX` with your actual URL from above)

### Update AI-Cred2tech-Eleg-Check-Engine/Jenkinsfile

Same change:

```groovy
CHAT_APPROVAL_URL = 'https://jenkins-chat-approval-XXXXX-as.a.run.app/notify'
```

### Commit & Push

```bash
git add nestjs-backend/Jenkinsfile AI-Cred2tech-Eleg-Check-Engine/Jenkinsfile
git commit -m "Enable Chat approval gate for all deployment pipelines"
git push origin main
```

---

## Now Your Team Can

When deploying `scheme-backend` or `eligibility-engine`:

1. **Deployment starts** → Backup runs → Approval gate opens
2. **Chat bot posts a card** to the `#prod-approvals` space:
   ```
   🚀 Approve Build #123 of scheme-backend?
   
   [Approve] [Reject]
   ```
3. **Team member clicks** Approve
4. **Jenkins automatically proceeds** the deployment (no need to click email/UI)
5. **Logs show:** "Approved via Google Chat by alice@cred2tech.com"

---

## Monitoring & Logs

### View Service Logs

```bash
gcloud run logs read jenkins-chat-approval --region asia-south1 --limit 50
```

### Watch Logs in Real-Time

```bash
gcloud run logs read jenkins-chat-approval --region asia-south1 --follow
```

### Check Service Status

```bash
gcloud run services describe jenkins-chat-approval --region asia-south1 --format=json
```

---

## Troubleshooting

**See detailed troubleshooting in:**
- `JENKINS_SETUP.md` → **Troubleshooting** section
- `SETUP_CHECKLIST.md` → **Phase 5**

**Quick fixes:**

| Problem | Solution |
|---------|----------|
| `gcloud: command not found` | Install: `curl https://sdk.cloud.google.com \| bash` |
| Build fails at Docker push | Check `gcp-sa-key-json` credential is valid |
| Health check fails | `gcloud run logs read jenkins-chat-approval` |
| Tests fail | Ensure `npm test` works locally: `npm test` |
| Approval email never arrives | Check Jenkins Email plugin is installed & configured |

---

## What Just Happened

✅ **Deployed:**
- Node.js/Express service to Google Cloud Run
- Integrated with Google Chat for interactive approvals
- Connected to Jenkins approval gates
- Secured with Google Workspace group membership

✅ **Available:**
- Three approval channels: Chat (new), Email (existing), Jenkins UI (existing)
- Automatic logging of who approved and which channel
- Rollback-friendly: previous Cloud Run revisions still exist
- Monitoring: logs available via `gcloud` CLI

✅ **Next:**
- Team approves deployments from Google Chat
- No manual clicking of email links or Jenkins UI needed
- Audit trail shows which channel and which person approved

---

## Support

**Quick reference:**
- `QUICK_START.md` — 5-minute version
- `SETUP_CHECKLIST.md` — detailed step-by-step  
- `JENKINS_SETUP.md` — Jenkins-specific + troubleshooting
- `README.md` — service architecture + authorization

**Still stuck?** Check the Troubleshooting section in the relevant doc above.

---

## Architecture

```
┌─ Google Chat ──────────────────────────────────┐
│                                                │
│  User sees card: "Approve Build #123?"        │
│  User clicks [Approve]                        │
│         ↓                                      │
└────────┼──────────────────────────────────────┘
         │
         │ Verifies user is in approvers@ group
         ↓
┌─ jenkins-chat-approval (Cloud Run) ──────────┐
│                                                │
│  - Checks Google Workspace membership         │
│  - Stamps Jenkins build description           │
│  - Calls Jenkins API to proceed input         │
│  - Updates Chat card with status              │
│         ↓                                      │
└────────┼──────────────────────────────────────┘
         │
         │ input step proceeds
         ↓
┌─ Jenkins Pipeline ──────────────────────────┐
│                                              │
│  Approval gate cleared → deployment starts  │
│  Deploys to production servers              │
│         ↓                                   │
└────────┼──────────────────────────────────┘
         │
         ↓
┌─ Production (nestjs-backend, eligibility-engine, etc.) ─┐
│                                                           │
│  Service updated, health checks pass, live!             │
│                                                           │
└───────────────────────────────────────────────────────┘
```

---

**Status: Ready to Deploy** ✅
