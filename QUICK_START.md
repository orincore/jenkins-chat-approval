# Jenkins Chat Approval - Quick Start (5 min)

## What This Does

Creates a **Google Chat ↔ Jenkins approval bridge** so your team can approve production deployments from Slack-like cards in Google Chat, instead of clicking Jenkins UI or email links.

```
Jenkins Deployment Gate
       ↓
    Posts Card to Google Chat
       ↓
    User clicks Approve/Reject
       ↓
    Jenkins automatically proceeds/aborts
```

---

## TL;DR Setup

### On Your Local Machine

```bash
cd jenkins-chat-approval

# 1. Download GCP service account key
gcloud iam service-accounts keys create sa-key.json \
  --iam-account=chat-approver@cred2tech.iam.gserviceaccount.com

# 2. Create secrets (replace with real values)
echo -n "your-shared-secret-here" | \
  gcloud secrets create chat-approval-secret --data-file=-

echo -n "jenkins-bot-api-token-here" | \
  gcloud secrets create jenkins-bot-token --data-file=-

# 3. Get info you'll need
gcloud projects describe cred2tech --format='value(projectNumber)'
# → Save this as CHAT_AUDIENCE

# Get CHAT_SPACE from Google Chat API config (spaces/XXXXX)
# Get JENKINS_URL (https://jenkins.cred2tech.com)
# Get JENKINS_BOT_USER (chat-approver-bot)
# Get APPROVERS_GROUP (approvers@cred2tech.com)
# Get DIRECTORY_IMPERSONATE_USER (it-admin@cred2tech.com)
```

### In Jenkins UI

1. **Credentials** → **Add Credentials** → **File**
   - Upload `sa-key.json`
   - ID: `gcp-sa-key-json`

2. **New Item** → **Pipeline**
   - Name: `jenkins-chat-approval`
   - SCM: Git → `https://github.com/adarshcred2tech/jenkins-chat-approval.git`
   - Branch: `*/main`
   - Script Path: `Jenkinsfile`

3. **Edit Jenkinsfile** (line ~180):
   ```groovy
   --set-env-vars CHAT_SPACE=spaces/YOUR_SPACE,CHAT_AUDIENCE=YOUR_PROJECT_NUMBER,...
   ```

4. **Build Now** → Approve when gate appears → Done!

---

## What Gets Deployed

- **Node.js/Express service** running on Google Cloud Run
- **Listens on** `/notify` (from Jenkins) + `/` (from Google Chat)
- **Authenticates** via Google Workspace group membership
- **Auto-manages** deployment, health checks, rollback

---

## After Deployment

### Enable Chat in Other Pipelines

In `nestjs-backend/Jenkinsfile` and `AI-Cred2tech-Eleg-Check-Engine/Jenkinsfile`, add:

```groovy
CHAT_APPROVAL_URL = 'https://jenkins-chat-approval-XXXXX-as.a.run.app/notify'
```

Get the URL from the Jenkins build output (Cloud Run URL).

### Your Team Can Now

1. **Jenkins posts** a Card to Google Chat when a deployment gate opens
2. **Team clicks** Approve/Reject button
3. **Chat verification** checks if user is in `approvers@cred2tech.com` group
4. **Jenkins proceeds** automatically (no need to click Jenkins UI or email link)
5. **Logs show** "Approved via Google Chat by [user]"

---

## If Something Goes Wrong

| Error | Fix |
|-------|-----|
| `gcloud: command not found` | Install: `curl https://sdk.cloud.google.com \| bash` |
| `docker: command not found` | Install: `curl https://get.docker.com \| sh` |
| Health check fails | Check logs: `gcloud run logs read jenkins-chat-approval` |
| Approval gate never shows | Check email for approval link; ensure email plugin is installed |

---

## Files You Need

- `Jenkinsfile` — pipeline definition
- `SETUP_CHECKLIST.md` — detailed step-by-step (if Quick Start isn't enough)
- `JENKINS_SETUP.md` — Jenkins-specific config + troubleshooting

---

## Next Steps

1. ✅ Follow **Quick Start** above
2. ✅ Monitor first deployment in Jenkins
3. ✅ Approve via email when gate appears
4. ✅ Get Cloud Run URL from build output
5. ✅ Update other Jenkinsfiles with `CHAT_APPROVAL_URL`
6. ✅ Test by deploying backend or engine — approve via Chat!

**Questions?** See `JENKINS_SETUP.md` for detailed troubleshooting.
