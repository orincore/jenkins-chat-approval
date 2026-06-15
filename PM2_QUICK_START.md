# Jenkins Chat Approval - PM2 Quick Start

## 3-Step Setup

### Step 1: Create Env File (on your server)

```bash
sudo cat > /etc/cred2tech/jenkins-chat-approval.env << 'EOF'
NODE_ENV=production
PORT=9000
CHAT_SPACE=spaces/YOUR_SPACE_ID
CHAT_AUDIENCE=YOUR_PROJECT_NUMBER
JENKINS_URL=https://jenkins.cred2tech.com
JENKINS_BOT_USER=chat-approver-bot
JENKINS_BOT_TOKEN=YOUR_JENKINS_BOT_TOKEN
APPROVERS_GROUP=approvers@cred2tech.com
AUTHZ_VIA_GROUP=true
DIRECTORY_IMPERSONATE_USER=it-admin@cred2tech.com
APPROVAL_SHARED_SECRET=YOUR_SHARED_SECRET
EOF

sudo chmod 600 /etc/cred2tech/jenkins-chat-approval.env
```

### Step 2: Create Jenkins Job

1. Jenkins → **New Item** → **Pipeline**
2. **Name:** `jenkins-chat-approval`
3. **Pipeline** → **Definition:** Pipeline script from SCM
4. **SCM:** Git
   - **Repo URL:** `https://github.com/adarshcred2tech/jenkins-chat-approval.git`
   - **Credentials:** `github-cred2tech`
   - **Branch:** `*/main`
   - **Script Path:** `Jenkinsfile`
5. **Save**

### Step 3: Build & Deploy

1. Click **Build Now**
2. Approve when email arrives
3. Done!

---

## Verify It's Working

```bash
# Check service is running
pm2 list

# Check it's responding
curl http://localhost:9000/

# Check logs
pm2 logs jenkins-chat-approval
```

---

## Enable Chat in Other Jenkinsfiles

### In `nestjs-backend/Jenkinsfile`

Add to `environment {}`:
```groovy
CHAT_APPROVAL_URL = 'https://your-server.com:9000/notify'
```

### In `AI-Cred2tech-Eleg-Check-Engine/Jenkinsfile`

Same:
```groovy
CHAT_APPROVAL_URL = 'https://your-server.com:9000/notify'
```

### Add Jenkins Secret

1. Jenkins → **Credentials** → **Add Credentials** → **Secret text**
2. **Secret:** (same as `APPROVAL_SHARED_SECRET` from env file)
3. **ID:** `chat-approval-secret`

---

## Now Your Team Can

Deploy backend or eligibility-engine → Google Chat posts approval card → team clicks Approve → deployment proceeds automatically ✅

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Service won't start | Check env file: `cat /etc/cred2tech/jenkins-chat-approval.env` |
| Health check fails | Check logs: `pm2 logs jenkins-chat-approval` |
| Chat approvals not working | Verify shared secret matches (env file + Jenkins credential) |
| Port already in use | Change PORT in env file to different port (e.g., 9001) |

**See SELF_HOSTED_SETUP.md for detailed troubleshooting.**

---

## That's It! 🎉

Your team can now approve production deployments from Google Chat instead of clicking Jenkins UI or email links.
