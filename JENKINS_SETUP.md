# Jenkins Pipeline Setup for jenkins-chat-approval

This guide walks through setting up the Jenkins pipeline to build and deploy the Chat approval bridge to Google Cloud Run.

## Prerequisites

1. **GCP Project** with Cloud Run API enabled
2. **Service Account** (`chat-approver@PROJECT.iam.gserviceaccount.com`) with:
   - Cloud Run Admin role
   - Artifact Registry Writer role
   - Secret Manager Accessor role
   - Domain-wide delegation configured (for Google Workspace group checks)
3. **Secrets in GCP Secret Manager:**
   - `chat-approval-secret` — shared secret used by Jenkins to call `/notify`
   - `jenkins-bot-token` — Jenkins API token for the `chat-approver-bot` user
4. **Jenkins** with Docker plugin and `gcloud` CLI installed
5. **Git** repository access (configured with GitHub credentials)

---

## Step 1: Add Jenkins Credentials

### A. GCP Service Account Key
1. In Jenkins: **Manage Jenkins** → **Credentials** → **System** → **Global Credentials**
2. Click **Add Credentials**
3. **Kind:** File
4. **Credential ID:** `gcp-sa-key-json`
5. **File:** Upload the service account JSON key
   ```bash
   # Download from GCP Console or use existing key
   gcloud iam service-accounts keys create ~/key.json \
     --iam-account=chat-approver@PROJECT.iam.gserviceaccount.com
   ```

### B. GitHub Repository Access
1. Ensure you have `github-cred2tech` credentials configured (already used by other pipelines)
2. If not, add a GitHub personal access token:
   - **Kind:** Username with password
   - **Credential ID:** `github-cred2tech`

---

## Step 2: Create Jenkins Pipeline Job

### A. In Jenkins UI
1. **New Item** → **Pipeline** → **OK**
2. **Name:** `jenkins-chat-approval` (or `Cred2Tech/jenkins-chat-approval` if using a folder)
3. **Pipeline** section:
   - **Definition:** Pipeline script from SCM
   - **SCM:** Git
   - **Repository URL:** `https://github.com/adarshcred2tech/jenkins-chat-approval.git`
   - **Credentials:** `github-cred2tech`
   - **Branch:** `*/main`
   - **Script Path:** `Jenkinsfile`

### B. Build Triggers (optional)
- **GitHub hook trigger for GITScm polling:** (requires GitHub webhook configured)
- **Poll SCM:** `H H * * *` (daily build)

---

## Step 3: Configure Cloud Run Environment Variables

Before the first deployment, update the Jenkinsfile with your actual values. In the **Deploy to Cloud Run** stage, replace these placeholders:

```groovy
--update-secrets APPROVAL_SHARED_SECRET=chat-approval-secret:latest,JENKINS_BOT_TOKEN=jenkins-bot-token:latest \
--set-env-vars CHAT_SPACE=spaces/AAAA...,CHAT_AUDIENCE=123456789012,JENKINS_URL=https://jenkins.cred2tech.com,JENKINS_BOT_USER=chat-approver-bot,APPROVERS_GROUP=approvers@cred2tech.com,AUTHZ_VIA_GROUP=true,DIRECTORY_IMPERSONATE_USER=it-admin@cred2tech.com
```

**Required values:**

| Env Var | Example | How to Find |
|---------|---------|------------|
| `CHAT_SPACE` | `spaces/AAAA1234567...` | Google Chat API → click the app → Config → note the space ID |
| `CHAT_AUDIENCE` | `123456789012` | GCP Console → IAM & Admin → Settings → Project Number |
| `JENKINS_URL` | `https://jenkins.cred2tech.com` | Your Jenkins domain |
| `JENKINS_BOT_USER` | `chat-approver-bot` | Jenkins user you created for the bot |
| `APPROVERS_GROUP` | `approvers@cred2tech.com` | Your Workspace group |
| `DIRECTORY_IMPERSONATE_USER` | `it-admin@cred2tech.com` | A Workspace admin who can read group membership |

---

## Step 4: Configure Jenkins Credentials for Secret Manager Access

The pipeline uses `--update-secrets` which requires gcloud to have access to Secret Manager. Make sure:

1. The GCP Service Account has `roles/secretmanager.secretAccessor` on the secrets
2. The secrets exist in GCP Secret Manager with the names above

```bash
gcloud secrets versions access latest --secret="chat-approval-secret"
gcloud secrets versions access latest --secret="jenkins-bot-token"
```

---

## Step 5: First Deployment

### A. Trigger the Build
1. In Jenkins, click **Build Now** on the `jenkins-chat-approval` job
2. Pipeline will:
   - Check out code from GitHub
   - Run tests (`npm test`)
   - Build Docker image
   - Pause at **Approval Gate** (email will be sent)

### B. Review & Approve
1. Click the approval link in the email (or go to Jenkins UI)
2. Review the commit message and build details
3. Click **Deploy to Production**

### C. Watch Deployment
1. Docker image is pushed to Artifact Registry
2. Service is deployed to Cloud Run
3. Health checks run (up to 12 retries, 5s between each)
4. Smoke tests verify the service is responding
5. Success email sent with the Cloud Run URL

---

## Step 6: Post-Deployment

### Enable the Chat Approval Feature in Other Jenkinsfiles

Once the service is live at a Cloud Run URL (e.g., `https://jenkins-chat-approval-xxxxx-as.a.run.app`), update your other Jenkinsfiles to use it:

**In `nestjs-backend/Jenkinsfile`:**
```groovy
CHAT_APPROVAL_URL = 'https://jenkins-chat-approval-xxxxx-as.a.run.app/notify'
```

**In `AI-Cred2tech-Eleg-Check-Engine/Jenkinsfile`:**
```groovy
CHAT_APPROVAL_URL = 'https://jenkins-chat-approval-xxxxx-as.a.run.app/notify'
```

Also add the shared secret to Jenkins credentials:
- **Kind:** Secret text
- **Credential ID:** `chat-approval-secret`
- **Secret:** (same value as GCP Secret Manager `chat-approval-secret`)

---

## Step 7: Troubleshooting

### Docker Login Fails
```
Error saving credentials: Invalid username <_json_key>
```
→ Make sure the GCP key file is valid and Docker daemon is running.

### Cloud Run Deployment Fails
```
gcloud: command not found
```
→ Install `google-cloud-cli` on the Jenkins agent:
```bash
sudo apt-get update && sudo apt-get install google-cloud-cli
```

### Health Check Fails
```
curl: (7) Failed to connect to service
```
→ Service may not be responding yet. Check Cloud Run logs:
```bash
gcloud run logs read jenkins-chat-approval --region asia-south1
```

### Tests Fail
```
npm ERR! code ENOENT
npm ERR! errno -2
npm ERR! syscall open
npm ERR! path /path/to/node_modules/...
```
→ Run `npm ci --include=dev` to ensure test dependencies are installed. The `npm test` stage assumes a test runner is configured in `package.json`.

---

## Maintenance

### Rolling Back a Deployment
If a deployment goes wrong, Cloud Run keeps the previous service revision. To rollback:

```bash
gcloud run services describe jenkins-chat-approval \
  --region asia-south1 \
  --format='table(status.traffic)'

# Traffic should still point to the new revision. To revert:
gcloud run services update-traffic jenkins-chat-approval \
  --region asia-south1 \
  --to-revisions REVISION_NAME=100
```

Or simply re-run the Jenkins job and approve again — it will deploy the previous image tag.

### Updating Environment Variables
If you need to change `CHAT_SPACE`, `APPROVERS_GROUP`, etc., edit the Jenkinsfile and re-run the pipeline. No manual gcloud commands needed.

---

## Related Documentation

- [Jenkinsfile](./Jenkinsfile) — the pipeline definition
- [README.md](./README.md) — Chat approval bridge architecture + setup
- [GCP Cloud Run Docs](https://cloud.google.com/run/docs/deploying)
