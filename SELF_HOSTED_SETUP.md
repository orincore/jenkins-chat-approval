# Jenkins Chat Approval - Self-Hosted PM2 Setup

Deploy as a PM2 service on your server (like scheme-backend and eligibility-engine).

---

## Quick Setup (5 min)

### 1. Create Env File on Server

SSH into your server and create `/etc/cred2tech/jenkins-chat-approval.env`:

```bash
sudo cat > /etc/cred2tech/jenkins-chat-approval.env << 'EOF'
NODE_ENV=production
PORT=9000

# Google Chat Space (from Google Chat API config)
CHAT_SPACE=spaces/YOUR_SPACE_ID_HERE

# GCP Project number (from Google Cloud Console)
CHAT_AUDIENCE=YOUR_PROJECT_NUMBER_HERE

# Jenkins integration
JENKINS_URL=https://jenkins.cred2tech.com
JENKINS_BOT_USER=chat-approver-bot
JENKINS_BOT_TOKEN=YOUR_JENKINS_BOT_API_TOKEN

# Google Workspace
APPROVERS_GROUP=approvers@cred2tech.com
AUTHZ_VIA_GROUP=true
DIRECTORY_IMPERSONATE_USER=it-admin@cred2tech.com

# Shared secret (same as what Jenkins sends)
APPROVAL_SHARED_SECRET=YOUR_SHARED_SECRET_HERE
EOF

sudo chmod 600 /etc/cred2tech/jenkins-chat-approval.env
```

### 2. Create Jenkins Job

1. Jenkins → **New Item** → **Pipeline**
2. **Name:** `jenkins-chat-approval`
3. Under **Pipeline**:
   - **Definition:** Pipeline script from SCM
   - **SCM:** Git
   - **Repository URL:** `https://github.com/adarshcred2tech/jenkins-chat-approval.git`
   - **Credentials:** `github-cred2tech`
   - **Branch:** `*/main`
   - **Script Path:** `Jenkinsfile`
4. **Save**

### 3. Build & Deploy

1. Jenkins → `jenkins-chat-approval` → **Build Now**
2. Wait for **Approval Gate** → check email
3. Click approval link → **Deploy to Production**
4. Service starts on your server

---

## Verification

After deployment, verify the service is running:

```bash
# Check PM2 status
pm2 list | grep jenkins-chat-approval

# Check logs
pm2 logs jenkins-chat-approval

# Test the service
curl http://localhost:9000/

# Watch logs in real-time
pm2 logs jenkins-chat-approval --follow
```

---

## Configuration

### Environment Variables

All config is in `/etc/cred2tech/jenkins-chat-approval.env`:

| Variable | Example | Required |
|----------|---------|----------|
| `NODE_ENV` | `production` | Yes |
| `PORT` | `9000` | Yes |
| `CHAT_SPACE` | `spaces/AAAA1234...` | Yes |
| `CHAT_AUDIENCE` | `123456789012` | Yes |
| `JENKINS_URL` | `https://jenkins.cred2tech.com` | Yes |
| `JENKINS_BOT_USER` | `chat-approver-bot` | Yes |
| `JENKINS_BOT_TOKEN` | Your API token | Yes |
| `APPROVERS_GROUP` | `approvers@cred2tech.com` | Yes |
| `AUTHZ_VIA_GROUP` | `true` | Yes |
| `DIRECTORY_IMPERSONATE_USER` | `it-admin@cred2tech.com` | Yes |
| `APPROVAL_SHARED_SECRET` | Your secret | Yes |

### Where to Find Values

| Variable | Where to Find |
|----------|---------------|
| `CHAT_SPACE` | Google Chat API console → Configuration → note the space ID |
| `CHAT_AUDIENCE` | GCP Console → Settings → Project Number |
| `JENKINS_URL` | Your Jenkins domain |
| `JENKINS_BOT_USER` | Jenkins user you created (member of `approver` role) |
| `JENKINS_BOT_TOKEN` | Jenkins → User → API Token |
| `APPROVERS_GROUP` | Your Google Workspace group |
| `DIRECTORY_IMPERSONATE_USER` | Any Workspace admin |
| `APPROVAL_SHARED_SECRET` | Any random string (must match what Jenkins sends) |

---

## Enable Chat Approvals in Jenkinsfiles

Once the service is running on your server (e.g., `https://your-server.com:9000`), update the other Jenkinsfiles:

### nestjs-backend/Jenkinsfile

Find the `environment {}` block and set:

```groovy
CHAT_APPROVAL_URL = 'https://your-server.com:9000/notify'
```

### AI-Cred2tech-Eleg-Check-Engine/Jenkinsfile

Same change:

```groovy
CHAT_APPROVAL_URL = 'https://your-server.com:9000/notify'
```

Also add the shared secret to Jenkins:
1. Jenkins → **Manage Jenkins** → **Credentials** → **System** → **Global Credentials**
2. **Add Credentials** → **Secret text**
   - **Secret:** (same value as `APPROVAL_SHARED_SECRET` in the env file)
   - **Credential ID:** `chat-approval-secret`

---

## Monitoring

### View Service Status

```bash
pm2 show jenkins-chat-approval
```

### View Logs

```bash
# Last 50 lines
pm2 logs jenkins-chat-approval --lines 50

# Follow logs in real-time
pm2 logs jenkins-chat-approval --follow

# Grep for errors
pm2 logs jenkins-chat-approval | grep ERROR
```

### Restart Service

```bash
pm2 restart jenkins-chat-approval
pm2 save
```

### Stop Service

```bash
pm2 stop jenkins-chat-approval
pm2 save
```

---

## Troubleshooting

### Service won't start

```bash
# Check logs
pm2 logs jenkins-chat-approval

# Verify env file exists
cat /etc/cred2tech/jenkins-chat-approval.env

# Test npm dependencies
cd /opt/cred2tech/jenkins-chat-approval/current
npm install
```

### Service crashes

```bash
# Check memory/CPU
pm2 monit

# Check if port 9000 is in use
lsof -i :9000

# Check logs for errors
pm2 logs jenkins-chat-approval --lines 100
```

### Health check fails in deployment

Service must respond to `http://localhost:9000/` within 60 seconds of restart.

```bash
# Test manually
curl -i http://localhost:9000/

# Check logs
pm2 logs jenkins-chat-approval
```

### Chat approvals not working

1. Verify `APPROVAL_SHARED_SECRET` matches in both service env file AND Jenkins credential
2. Verify `JENKINS_BOT_TOKEN` is valid (test: `curl -u chat-approver-bot:TOKEN https://jenkins.cred2tech.com/api/json`)
3. Check service logs for auth errors: `pm2 logs jenkins-chat-approval`

---

## Maintenance

### Updating the Service

When you push a new commit to `main`:

1. Jenkins detects it
2. Runs tests
3. Pauses at approval gate
4. You approve
5. Service is updated on the server
6. PM2 reloads it gracefully

### Rollback

If deployment fails, the Jenkinsfile automatically rolls back to the previous release.

Or manually:

```bash
# List available releases
ls -1d /opt/cred2tech/jenkins-chat-approval/releases/*/

# Switch to a previous release (e.g., 20260615_102000)
ln -sfn /opt/cred2tech/jenkins-chat-approval/releases/20260615_102000 /opt/cred2tech/jenkins-chat-approval/current

# Reload PM2
pm2 reload /opt/cred2tech/jenkins-chat-approval/current/ecosystem.config.js
```

---

## Architecture

```
┌─ Jenkins ──────────────────┐
│                             │
│ Deploy job triggers        │
│ (on push to main)          │
│          ↓                 │
└──────────┼─────────────────┘
           │
           ├─ Checkout code
           ├─ Run tests
           ├─ Approval gate (email)
           ├─ Copy to server
           ├─ Install deps
           ├─ Stop old PM2 process
           ├─ Start new PM2 process
           ├─ Health check
           ↓
┌─ Your Server ──────────────┐
│                             │
│ PM2 process running        │
│ jenkins-chat-approval      │
│                             │
│ Listens on:                │
│ - http://localhost:9000    │
│ - POST /notify (Jenkins)   │
│ - POST / (Google Chat)     │
│                             │
└─────────────────────────────┘
           ↑
           │ HTTP (via reverse proxy)
           │
       [nginx/apache]
           │
     https://your-server.com/jenkins-chat-approval
```

---

## Done!

Your team can now approve deployments from:
- 📧 **Email** (existing)
- 🔘 **Jenkins UI** (existing)
- 💬 **Google Chat** (NEW)

All three approval methods gate the same Jenkins input step.

✅ **Setup complete when:**
- [ ] Env file created on server
- [ ] Jenkins job created
- [ ] First build triggered and approved
- [ ] Service running on PM2
- [ ] Health checks passing
- [ ] Chat Approval URL added to other Jenkinsfiles
- [ ] Team tests approval from Chat
