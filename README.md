# Jenkins ⇄ Google Chat deployment approvals (Cred2Tech)

Approve production deploys from **three interchangeable channels**, all gating the
same Jenkins `input` step — and the pipeline logs **which channel** and **which
person** approved:

1. **Jenkins UI** button (unchanged).
2. **Email** deep-link (already in the Jenkinsfiles — one click to the approval form).
3. **Google Chat** Approve/Reject card (this service).

Authorization is the **same Google Group** (`approvers@cred2tech.com`) everywhere:
it drives the Jenkins `approver` role via SAML, and the Chat bridge checks the
same group before it proceeds the build. Add/remove someone in Google Workspace →
their approval rights update everywhere. No per-system user management.

```
Gate opens
  ├─ Jenkins UI ─────────────────────────────► input proceeds (submitter = the human)
  ├─ Email link ─────────────────────────────► input proceeds (submitter = the human)
  └─ /notify ─► Chat card ─► user clicks ─► this service
                 (verifies group) ─► stamps build description ("Approved via Google Chat by …")
                                   └─► input proceeds as CHAT_BOT_USER
```

The pipeline detects the Chat channel because the bridge submits as `CHAT_BOT_USER`
and writes the human approver into the build description.

---

## Part A — Google Chat approval bridge (Cloud Run)

### A1. GCP project & APIs
Enable in your GCP project: **Cloud Run**, **Google Chat API**, **Admin SDK API**,
**Secret Manager**, **Artifact Registry**.

### A2. Service account
Create `chat-approver@<project>.iam.gserviceaccount.com`. This is the Cloud Run
runtime identity. Grant it:
- nothing special on GCP beyond running the service, **and**
- **domain-wide delegation** (DWD) for the directory read, scope:
  `https://www.googleapis.com/auth/admin.directory.group.member.readonly`
  (Google Admin → Security → API controls → Domain-wide delegation → add the
  SA client ID with that scope). `DIRECTORY_IMPERSONATE_USER` must be a Workspace
  user allowed to read group membership.

### A3. Chat app
Google Chat API → **Configuration**:
- App name / avatar, **Interactive features = ON**.
- **Connection settings → App URL (HTTP endpoint)** = your Cloud Run URL (root `/`).
- **Permissions** = the people/group who can use it.
- Note the **project number** → that is `CHAT_AUDIENCE`.
- Add the app to a space (e.g. `#prod-approvals`) and read the space id
  (`spaces/AAAA…`) → `CHAT_SPACE`.

### A4. Jenkins bot user
Create a Jenkins user `chat-approver-bot`, add it to the **`approver`** role
(so it is allowed to submit the gate), and generate an **API token** →
`JENKINS_BOT_TOKEN`.

### A5. Deploy
```bash
cd jenkins-chat-approval

gcloud run deploy jenkins-chat-approval \
  --source . \
  --region asia-south1 \
  --service-account chat-approver@<project>.iam.gserviceaccount.com \
  --no-allow-unauthenticated \
  --set-env-vars CHAT_SPACE=spaces/AAAA...,CHAT_AUDIENCE=123456789012,\
JENKINS_URL=https://jenkins.cred2tech.com,JENKINS_BOT_USER=chat-approver-bot,\
APPROVERS_GROUP=approvers@cred2tech.com,AUTHZ_VIA_GROUP=true,\
DIRECTORY_IMPERSONATE_USER=it-admin@cred2tech.com \
  --set-secrets APPROVAL_SHARED_SECRET=chat-approval-secret:latest,\
JENKINS_BOT_TOKEN=jenkins-bot-token:latest
```
> Google Chat must reach the endpoint. Either allow the **Chat service account**
> to invoke it (`roles/run.invoker` to `chat@system.gserviceaccount.com`) with
> `--no-allow-unauthenticated`, or use `--allow-unauthenticated` and rely on the
> in-app token verification (`verifyChatRequest`). The `/notify` path is always
> protected by `APPROVAL_SHARED_SECRET`.

### A6. Jenkins side (enable the channel)
In each Jenkinsfile the feature is **off** until you set `CHAT_APPROVAL_URL`:
1. Add a **Secret text** credential `chat-approval-secret` = the same value as the
   service's `APPROVAL_SHARED_SECRET`.
2. Set `CHAT_APPROVAL_URL = 'https://<cloud-run-url>/notify'` in the Jenkinsfile
   `environment {}` block (or as a global env var).
3. Keep `CHAT_BOT_USER = 'chat-approver-bot'` matching the bot user.

That's it — the gate now also posts a Chat card. UI + email keep working even if
the Chat post fails (it's wrapped best-effort).

---

## Part B — Google Workspace SSO + group→role sync (SAML)

Goal: log into Jenkins with Workspace accounts, and let **Google Group membership**
decide Jenkins permissions (so `approvers@cred2tech.com` ⇒ the `approver` role used
by the gate). OIDC can't do the group part with Google — **SAML can**.

### B1. Jenkins plugins
Install **SAML Plugin** and **Role-based Authorization Strategy**.

### B2. Google Admin → SAML app
Admin console → Apps → Web and mobile apps → **Add custom SAML app**:
- Download the **IdP metadata** (SSO URL, entity ID, certificate).
- **ACS URL** = `https://jenkins.cred2tech.com/securityRealm/finishLogin`
- **Entity ID** = `https://jenkins.cred2tech.com/securityRealm/`
- **Attribute mapping**: map `email`, `first/last name`, and most importantly add a
  **Group membership** attribute (e.g. name it `groups`) listing the groups Jenkins
  cares about (e.g. `approvers`, `developers`). Google sends only those the user
  is in.
- Turn the app **ON** for everyone (or the relevant OUs).

### B3. Jenkins → Configure Global Security
- **Security Realm = SAML 2.0**: paste the IdP metadata; set
  **Group attribute = `groups`**, Username/email attributes to the mapped ones.
- **Authorization = Role-Based Strategy**.

### B4. Roles
Manage and Assign Roles → **Assign Roles → Group roles**: add the **group name**
exactly as Google sends it (e.g. `approvers`) and tick the `approver` role (the one
referenced by `submitter: 'approver'` in the Jenkinsfiles). Now membership of the
Google Group is the single source of truth for who can clear the gate — in the UI,
via email, and via Chat.

---

## What gets logged

On every approval the pipeline prints:
```
 PRODUCTION DEPLOYMENT APPROVED
   Service : scheme-backend
   Build   : #123 (20260608_101500)
   Approver: alice@cred2tech.com            # human, even when approved via Chat
   Channel : Google Chat                    # or "Jenkins Web (UI button / email link)"
   Time    : 2026-06-08 10:17:42 IST
```
`env.APPROVED_BY` and `env.APPROVAL_CHANNEL` are also set for the post-build emails.

## Local dev
```bash
npm install
cp .env.example .env   # fill values
npm start              # listens on :8080
npm test               # Jenkins proceed/abort/crumb tests (mocked fetch, no live Jenkins)
```
# Webhook test
