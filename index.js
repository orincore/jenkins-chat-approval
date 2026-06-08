/**
 * Jenkins <-> Google Chat production-approval bridge (Cloud Run).
 *
 * Two inbound surfaces, one service:
 *
 *   POST /notify   ← called by the Jenkins pipeline when an approval gate opens.
 *                    Authenticated with a shared secret. Posts an interactive
 *                    Approve / Reject card into the configured Chat space.
 *
 *   POST /         ← called by Google Chat for interaction events (button clicks).
 *                    Authenticated by verifying Google's signed request token.
 *                    On Approve/Reject it:
 *                      1. checks the clicker is in the approvers@ Google Group,
 *                      2. stamps the Jenkins build description with the human
 *                         approver + channel (so the pipeline can log it),
 *                      3. proceeds / aborts the Jenkins `input` step via its API,
 *                      4. updates the Chat card to a final state.
 *
 * The human authorization lives in the Google Group (same group that drives the
 * Jenkins `approver` role via SAML), so Workspace membership is the single source
 * of truth for who may approve — whether they click in Jenkins or in Chat.
 */

import 'dotenv/config.js';
import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import { createJenkinsClient } from './jenkins.js';

const {
  PORT = '8080',

  // Shared secret that Jenkins sends in the X-Approval-Secret header on /notify.
  APPROVAL_SHARED_SECRET,

  // Google Chat space to post approval cards into, e.g. "spaces/AAAA1234".
  CHAT_SPACE,

  // The Cloud project NUMBER configured as the Chat app audience (Chat API console).
  CHAT_AUDIENCE,

  // Jenkins API access (a dedicated bot user that is a member of the approver role).
  JENKINS_URL,            // e.g. https://jenkins.cred2tech.com
  JENKINS_BOT_USER,       // e.g. chat-approver-bot
  JENKINS_BOT_TOKEN,      // Jenkins API token for the bot user

  // Authorization: the Google Group whose members may approve, e.g. approvers@cred2tech.com
  APPROVERS_GROUP,
  // Set to "false" to skip the group check (NOT recommended for production).
  AUTHZ_VIA_GROUP = 'true',
  // A super-admin (or a user with directory read) for the Admin SDK to impersonate
  // via the service account's domain-wide delegation, e.g. it-admin@cred2tech.com
  DIRECTORY_IMPERSONATE_USER,
} = process.env;

const app = express();
app.use(express.json());

// ── Google API clients ───────────────────────────────────────────────────────
// On Cloud Run, Application Default Credentials = the service account attached to
// the revision. It needs the Chat bot scope and (for the group check) domain-wide
// delegation impersonating DIRECTORY_IMPERSONATE_USER.
const chatAuth = new google.auth.GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/chat.bot'],
});
const chat = google.chat({ version: 'v1', auth: chatAuth });

const tokenVerifier = new OAuth2Client();

const jenkins = createJenkinsClient({
  baseUrl: JENKINS_URL,
  user: JENKINS_BOT_USER,
  token: JENKINS_BOT_TOKEN,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Verify an inbound Google Chat request is genuinely from Google Chat. */
async function verifyChatRequest(req) {
  const header = req.headers['authorization'] || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('missing bearer token');

  // Google Chat signs requests with the chat@system.gserviceaccount.com SA, with
  // the audience set to the project number configured for the Chat app.
  const ticket = await tokenVerifier.verifyIdToken({
    idToken: token,
    audience: CHAT_AUDIENCE,
  });
  const payload = ticket.getPayload();
  // Google Chat signs request tokens with either the classic Chat system account
  // (chat@system.gserviceaccount.com) or, for apps built as Workspace add-ons, the
  // add-on service account (service-<projectNumber>@gcp-sa-gsuiteaddons.iam...).
  // The token has no email_verified claim, so we just check the signer identity.
  const signer = payload.email || '';
  const isChatSigner =
    signer === 'chat@system.gserviceaccount.com' ||
    /^service-\d+@gcp-sa-gsuiteaddons\.iam\.gserviceaccount\.com$/.test(signer);
  if (!isChatSigner) {
    console.warn('unexpected Chat signer email:', signer);
    throw new Error('request not signed by Google Chat');
  }
  return payload;
}

/** Is `userEmail` a member of the approvers Google Group? */
async function isApprover(userEmail) {
  if (AUTHZ_VIA_GROUP !== 'true') return true;
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/admin.directory.group.member.readonly'],
    clientOptions: { subject: DIRECTORY_IMPERSONATE_USER },
  });
  const directory = google.admin({ version: 'directory_v1', auth });
  try {
    const res = await directory.members.hasMember({
      groupKey: APPROVERS_GROUP,
      memberKey: userEmail,
    });
    return res.data.isMember === true;
  } catch (err) {
    // hasMember 404s when the user is outside the group's domain — treat as "no".
    if (err?.code === 404) return false;
    throw err;
  }
}

/** Build the interactive approval card. `params` round-trips on every button. */
function approvalCard({ service, build, releaseTs, buildUrl, inputId, footer }) {
  const shared = { buildUrl, inputId, service, build, releaseTs: releaseTs || '' };
  const action = (fn) => ({
    action: {
      function: fn,
      parameters: Object.entries(shared).map(([key, value]) => ({ key, value: String(value) })),
    },
  });
  return {
    cardsV2: [{
      cardId: `approval-${service}-${build}`,
      card: {
        header: {
          title: 'Production deployment approval',
          subtitle: `${service} · build #${build}`,
        },
        sections: [{
          widgets: [
            { decoratedText: { topLabel: 'Service', text: service } },
            { decoratedText: { topLabel: 'Build', text: `#${build}` } },
            { decoratedText: { topLabel: 'Release', text: releaseTs } },
            { buttonList: { buttons: [
              { text: 'Approve & Deploy', color: { red: 0.18, green: 0.49, blue: 0.20 }, onClick: action('approve') },
              { text: 'Reject', color: { red: 0.78, green: 0.16, blue: 0.16 }, onClick: action('reject') },
            ] } },
            ...(footer ? [{ textParagraph: { text: footer } }] : []),
          ],
        }],
      },
    }],
  };
}

// ── /notify — Jenkins asks us to post an approval card ──────────────────────
app.post('/notify', async (req, res) => {
  if (!APPROVAL_SHARED_SECRET || req.headers['x-approval-secret'] !== APPROVAL_SHARED_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const { service, build, releaseTs, buildUrl, inputId } = req.body || {};
  if (!service || !build || !buildUrl || !inputId) {
    return res.status(400).json({ error: 'service, build, buildUrl and inputId are required' });
  }
  try {
    const card = approvalCard({ service, build, releaseTs, buildUrl, inputId });
    const result = await chat.spaces.messages.create({ parent: CHAT_SPACE, requestBody: card });
    return res.json({ ok: true, message: result.data.name });
  } catch (err) {
    console.error('notify failed', err);
    return res.status(500).json({ error: 'failed to post card' });
  }
});

// Add-on Chat response: post a message back into the space the click came from.
function chatReply(text) {
  return {
    hostAppDataAction: {
      chatDataAction: { createMessageAction: { message: { text } } },
    },
  };
}

// ── / — Google Chat interaction events (Workspace add-on format) ─────────────
app.post('/', async (req, res) => {
  try {
    await verifyChatRequest(req);
  } catch (err) {
    console.warn('rejected Chat request', err.message);
    return res.status(401).send('unauthorized');
  }

  // Workspace add-on Chat events arrive as { commonEventObject, chat, ... }.
  // A button click puts the button's function in commonEventObject.invokedFunction
  // and the button's parameters (a key→value map) in commonEventObject.parameters.
  const body = req.body || {};
  const ceo = body.commonEventObject || {};
  const fn = ceo.invokedFunction;
  const params = ceo.parameters || {};
  const userEmail = body.chat?.user?.email || '';
  console.log('CHAT interaction:', fn || '(none)', '| user:', userEmail, '| params:', JSON.stringify(params));

  // Anything that isn't an approve/reject click (added-to-space, message, etc.)
  // just gets an empty 200 — nothing to do.
  if (fn !== 'approve' && fn !== 'reject') {
    return res.json({});
  }

  const approve = fn === 'approve';
  const { buildUrl, inputId, service, build } = params;

  try {
    // Authorization lives in the Google Group — only approvers may clear the gate.
    if (!(await isApprover(userEmail))) {
      return res.json(chatReply(`⛔ ${userEmail} is not in ${APPROVERS_GROUP} — not authorised to approve deployments.`));
    }

    const crumb = await jenkins.crumb();
    if (approve) {
      await jenkins.setBuildDescription(buildUrl, `Approved via Google Chat by ${userEmail}`, crumb);
    }
    await jenkins.decideInput(buildUrl, inputId, approve, crumb);

    const verb = approve ? '✅ APPROVED' : '⛔ REJECTED';
    return res.json(chatReply(`${verb} — ${service} #${build} by ${userEmail}`));
  } catch (err) {
    console.error('decision failed', err);
    return res.json(chatReply(`⚠️ Could not record the decision for ${service} #${build}: ${err.message}. Use the Jenkins UI.`));
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.listen(Number(PORT), () => console.log(`jenkins-chat-approval listening on :${PORT}`));
