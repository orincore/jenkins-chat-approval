# Jenkins Chat Approval Pipeline - Setup Checklist

Complete this checklist to set up the pipeline in Jenkins.

## ✓ Prerequisites

- [ ] Jenkins instance running (version 2.361+)
- [ ] Jenkins plugins installed:
  - [ ] Pipeline
  - [ ] Pipeline: Stage View
  - [ ] Email Extension Plugin
  - [ ] Docker Pipeline (optional, for Docker operations)
  - [ ] Google Cloud Build (for GCP integration)
- [ ] Docker installed on Jenkins agent
- [ ] `gcloud` CLI installed on Jenkins agent
- [ ] GitHub access with `github-cred2tech` credentials already configured

---

## Phase 1: GCP Configuration (One-Time Setup)

### 1.1 Create/Verify Service Account

```bash
# Set your GCP project ID
export GCP_PROJECT_ID="cred2tech"
export GCP_REGION="asia-south1"

# Create service account (if not exists)
gcloud iam service-accounts create chat-approver \
  --display-name="Chat Approval Bridge" \
  --project=$GCP_PROJECT_ID

# Grant necessary roles
gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:chat-approver@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/run.admin"

gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:chat-approver@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding $GCP_PROJECT_ID \
  --member="serviceAccount:chat-approver@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

- [ ] Service account created
- [ ] Roles assigned

### 1.2 Create Service Account Key

```bash
mkdir -p ~/.gcp
gcloud iam service-accounts keys create ~/.gcp/chat-approver-key.json \
  --iam-account=chat-approver@${GCP_PROJECT_ID}.iam.gserviceaccount.com

# Store this securely — you'll upload it to Jenkins next
cat ~/.gcp/chat-approver-key.json
```

- [ ] Key file downloaded and saved securely

### 1.3 Create GCP Secrets

```bash
# Create secrets in Secret Manager (Jenkins will reference these at deploy time)
echo -n "YOUR_APPROVAL_SHARED_SECRET_HERE" | \
  gcloud secrets create chat-approval-secret \
    --replication-policy="automatic" \
    --data-file=-

echo -n "YOUR_JENKINS_BOT_API_TOKEN_HERE" | \
  gcloud secrets create jenkins-bot-token \
    --replication-policy="automatic" \
    --data-file=-

# Grant the service account access to these secrets
gcloud secrets add-iam-policy-binding chat-approval-secret \
  --member="serviceAccount:chat-approver@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding jenkins-bot-token \
  --member="serviceAccount:chat-approver@${GCP_PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

- [ ] `chat-approval-secret` created in Secret Manager
- [ ] `jenkins-bot-token` created in Secret Manager

### 1.4 Gather Required Values

Fill in these values (you'll need them for the Jenkinsfile):

```bash
# Get project number (needed for CHAT_AUDIENCE)
gcloud projects describe $GCP_PROJECT_ID --format='value(projectNumber)'
# Output: CHAT_AUDIENCE = ___________________________

# Get Chat space ID from Google Chat API config
# Go to: https://workspace.google.com/u/0/business/products/chat-api/
# Output: CHAT_SPACE = spaces/________________________

# Jenkins values
# Output: JENKINS_URL = https://jenkins.cred2tech.com
# Output: JENKINS_BOT_USER = chat-approver-bot
# Output: APPROVERS_GROUP = approvers@cred2tech.com
# Output: DIRECTORY_IMPERSONATE_USER = it-admin@cred2tech.com
```

- [ ] CHAT_AUDIENCE (project number)
- [ ] CHAT_SPACE (from Chat API config)
- [ ] JENKINS_URL
- [ ] JENKINS_BOT_USER
- [ ] APPROVERS_GROUP
- [ ] DIRECTORY_IMPERSONATE_USER

---

## Phase 2: Jenkins Configuration

### 2.1 Add GCP Service Account Credential

1. Go to **Jenkins** → **Manage Jenkins** → **Credentials** → **System** → **Global Credentials**
2. Click **Add Credentials**
3. Fill in:
   - **Kind:** File
   - **Scope:** Global
   - **File:** Upload `~/.gcp/chat-approver-key.json`
   - **Credential ID:** `gcp-sa-key-json`
   - **Description:** GCP Chat Approver Service Account
4. Click **Create**

- [ ] GCP credentials added as `gcp-sa-key-json`

### 2.2 Create Jenkins Pipeline Job

#### Option A: Via Jenkins UI

1. Go to Jenkins Dashboard
2. Click **New Item**
3. Enter **Item name:** `jenkins-chat-approval`
4. Select **Pipeline**
5. Click **OK**
6. Under **Pipeline** section, set:
   - **Definition:** Pipeline script from SCM
   - **SCM:** Git
   - **Repository URL:** `https://github.com/adarshcred2tech/jenkins-chat-approval.git`
   - **Credentials:** Select `github-cred2tech`
   - **Branch Specifier:** `*/main`
   - **Script Path:** `Jenkinsfile`
7. Click **Save**

#### Option B: Via Jenkins CLI (scripted)

```bash
# If you have Jenkins CLI configured
java -jar jenkins-cli.jar -s https://jenkins.cred2tech.com \
  create-job jenkins-chat-approval < /path/to/pipeline-config.xml
```

- [ ] Pipeline job created in Jenkins

### 2.3 Update Jenkinsfile with Your Values

Edit `jenkins-chat-approval/Jenkinsfile` and replace these placeholders:

**Line ~180** (in Deploy to Cloud Run stage):

```groovy
--set-env-vars CHAT_SPACE=spaces/AAAA...,CHAT_AUDIENCE=123456789012,JENKINS_URL=https://jenkins.cred2tech.com,JENKINS_BOT_USER=chat-approver-bot,APPROVERS_GROUP=approvers@cred2tech.com,AUTHZ_VIA_GROUP=true,DIRECTORY_IMPERSONATE_USER=it-admin@cred2tech.com
```

Replace with your actual values:

```groovy
--set-env-vars CHAT_SPACE=spaces/XXXXXXXXXXXXXXX,CHAT_AUDIENCE=1234567890,JENKINS_URL=https://jenkins.cred2tech.com,JENKINS_BOT_USER=chat-approver-bot,APPROVERS_GROUP=approvers@cred2tech.com,AUTHZ_VIA_GROUP=true,DIRECTORY_IMPERSONATE_USER=it-admin@cred2tech.com
```

- [ ] Jenkinsfile updated with actual GCP + Jenkins values

### 2.4 Verify Jenkins Agent Setup

On the Jenkins agent machine, run:

```bash
# Check Docker
docker --version

# Check gcloud CLI
gcloud --version

# Check Node.js (optional, for local testing)
node --version
npm --version
```

- [ ] Docker installed and working
- [ ] gcloud CLI installed and working

---

## Phase 3: Test the Pipeline

### 3.1 Trigger First Build

1. In Jenkins, go to the `jenkins-chat-approval` job
2. Click **Build Now**
3. Watch the build stages:
   - **Checkout** — clones the repo
   - **Validate Branch** — confirms `main` branch
   - **Install Dependencies** — runs `npm ci`
   - **Lint** — runs any lint scripts (optional)
   - **Test** — runs `npm test`
   - **Build Docker Image** — creates Docker image
   - **Approval Gate** — *pauses here*, email sent to team

- [ ] Build reaches Approval Gate (check email)

### 3.2 Approve Deployment

1. Check your email for approval link
2. Click the link or go to Jenkins UI: `https://jenkins.cred2tech.com/job/jenkins-chat-approval/[BUILD_NUMBER]/input/`
3. Click **Deploy to Production**
4. Watch remaining stages:
   - **Push Image** — pushes to Artifact Registry
   - **Deploy to Cloud Run** — deploys service
   - **Health Check** — verifies service is responding
   - **Smoke Tests** — runs integration tests
   - **Success** — build complete, success email sent

- [ ] Deployment completes successfully
- [ ] Success email received with Cloud Run URL

### 3.3 Verify Deployment

```bash
# Check the deployed service
gcloud run services describe jenkins-chat-approval \
  --region asia-south1 \
  --format='value(status.url)'

# Check service logs
gcloud run logs read jenkins-chat-approval \
  --region asia-south1 \
  --limit 10
```

- [ ] Service is running on Cloud Run
- [ ] Service is accessible (check logs for errors)

---

## Phase 4: Integration with Other Jenkinsfiles

Once the Chat Approval Bridge is running, enable it in your deployment pipelines.

### 4.1 Update nestjs-backend/Jenkinsfile

Find the `environment {}` block and add:

```groovy
CHAT_APPROVAL_URL = 'https://[CLOUD_RUN_URL]/notify'  // Replace with actual URL from Phase 3.3
```

Also ensure this line exists:
```groovy
CHAT_BOT_USER = 'chat-approver-bot'
```

### 4.2 Update AI-Cred2tech-Eleg-Check-Engine/Jenkinsfile

Same changes as above.

### 4.3 Add Shared Secret to Jenkins

1. Go to **Manage Jenkins** → **Credentials** → **Global Credentials**
2. Click **Add Credentials**
3. Fill in:
   - **Kind:** Secret text
   - **Scope:** Global
   - **Secret:** (same value as your GCP `chat-approval-secret`)
   - **Credential ID:** `chat-approval-secret`
   - **Description:** Chat Approval Bridge Shared Secret
4. Click **Create**

- [ ] Chat Approval Bridge integrated into other Jenkinsfiles
- [ ] Shared secret credential added

---

## Phase 5: Monitoring & Maintenance

### 5.1 Set Up Alerts

Monitor the Cloud Run service:

```bash
# Watch build logs in real-time
gcloud run logs read jenkins-chat-approval --region asia-south1 --follow
```

### 5.2 Rollback Procedure

If deployment goes wrong:

```bash
# View available revisions
gcloud run revisions list --service jenkins-chat-approval --region asia-south1

# Route traffic back to previous revision
gcloud run services update-traffic jenkins-chat-approval \
  --region asia-south1 \
  --to-revisions PREVIOUS_REVISION_NAME=100
```

Or simply re-run the Jenkins job.

- [ ] Monitoring setup complete

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `gcloud: command not found` | Install Google Cloud CLI: `sudo apt-get install google-cloud-cli` |
| `docker: command not found` | Install Docker: `curl https://get.docker.com \| sh` |
| `Permission denied` when pushing to Artifact Registry | Verify service account has `artifactregistry.writer` role |
| Health check fails | Check Cloud Run logs: `gcloud run logs read jenkins-chat-approval` |
| Tests fail | Ensure `npm test` script exists in `package.json` |
| Email not sent | Check that Email Extension plugin is installed and configured |

---

## Summary

✅ **Setup complete when:**
- [ ] GCP service account created with proper roles
- [ ] Jenkins credentials configured (`gcp-sa-key-json`)
- [ ] Pipeline job created in Jenkins
- [ ] First build triggered and approved
- [ ] Service deployed to Cloud Run successfully
- [ ] Chat Approval Bridge integrated into other pipelines
- [ ] Team can approve deployments via Chat/Email/Jenkins UI

🎉 **You can now approve production deployments from Google Chat!**
