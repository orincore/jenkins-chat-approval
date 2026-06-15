pipeline {
    agent any

    tools {
        nodejs 'node-lts'
    }

    environment {
        APP_NAME              = 'jenkins-chat-approval'
        PM2_APP               = 'jenkins-chat-approval'
        DEPLOY_BASE           = '/opt/cred2tech/jenkins-chat-approval'
        ENV_FILE              = '/etc/cred2tech/jenkins-chat-approval.env'
        APP_PORT              = '8081'
        HEALTH_URL            = 'http://localhost:8081/'
        NOTIFY_EMAIL          = 'adarsh.suradkar@cred2tech.com, cred2tech@gmail.com'
        GIT_REPO              = 'https://github.com/orincore/jenkins-chat-approval.git'
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '10'))
        timeout(time: 30, unit: 'MINUTES')
        timestamps()
        ansiColor('xterm')
    }

    stages {

        // ── 1. Checkout ──────────────────────────────────────────────────────────
        stage('Checkout') {
            steps {
                cleanWs()
                git branch: 'main',
                    credentialsId: 'github-cred2tech',
                    url: "${GIT_REPO}"
            }
        }

        // ── 2. Validate Branch ───────────────────────────────────────────────────
        stage('Validate Branch') {
            steps {
                script {
                    def branch = sh(script: 'git rev-parse --abbrev-ref HEAD', returnStdout: true).trim()
                    if (branch != 'main') {
                        error("Pipeline only runs on main branch. Got: ${branch}")
                    }
                    echo "Branch validated: ${branch}"
                }
            }
        }

        // ── 3. Install Dependencies ──────────────────────────────────────────────
        stage('Install Dependencies') {
            steps {
                sh 'npm ci'
            }
        }

        // ── 4. Lint (if configured) ─────────────────────────────────────────────
        stage('Lint') {
            steps {
                script {
                    if (fileExists('package.json')) {
                        def hasLint = sh(script: 'grep -q \'"lint"\' package.json', returnStatus: true) == 0
                        if (hasLint) {
                            sh 'npm run lint || true'
                        } else {
                            echo "No lint script configured — skipping."
                        }
                    }
                }
            }
        }

        // ── 5. Unit Tests ───────────────────────────────────────────────────────
        stage('Test') {
            steps {
                sh 'npm test'
            }
        }

        // ── 6. Deploy GCP Credentials ──────────────────────────────────────────────
        stage('Deploy GCP Credentials') {
            steps {
                script {
                    withCredentials([file(credentialsId: 'gcp-chat-approver-key', variable: 'GCP_KEY_FILE')]) {
                        sh '''
                            sudo mkdir -p /etc/cred2tech/gcp-keys
                            sudo cp $GCP_KEY_FILE /etc/cred2tech/gcp-keys/chat-approver-key.json
                            sudo chmod 600 /etc/cred2tech/gcp-keys/chat-approver-key.json

                            # Ensure GOOGLE_APPLICATION_CREDENTIALS is in the env file
                            if ! grep -q "GOOGLE_APPLICATION_CREDENTIALS" /etc/cred2tech/jenkins-chat-approval.env; then
                                echo "GOOGLE_APPLICATION_CREDENTIALS=/etc/cred2tech/gcp-keys/chat-approver-key.json" | sudo tee -a /etc/cred2tech/jenkins-chat-approval.env > /dev/null
                            fi

                            echo "GCP key deployed to /etc/cred2tech/gcp-keys/chat-approver-key.json"
                        '''
                    }
                }
            }
        }

        // ── 7. Approval Gate ────────────────────────────────────────────────────
        stage('Approval Gate') {
            steps {
                script {
                    def commit = sh(script: 'git log -1 --format="%s — %an (%h)"', returnStdout: true).trim()
                    def releaseTs = sh(script: 'date +%Y%m%d_%H%M%S', returnStdout: true).trim()

                    echo "Commit: ${commit}"
                    echo "Release: ${releaseTs}"

                    emailext(
                        to: "${env.NOTIFY_EMAIL}",
                        subject: "[jenkins-chat-approval] Build #${BUILD_NUMBER} awaiting PRODUCTION approval",
                        body: """
                            <h2 style="color:#4338ca;">Production deployment awaiting approval</h2>
                            <p>Build <b>#${BUILD_NUMBER}</b> (${releaseTs}) is built and ready to deploy to production.</p>
                            <table>
                              <tr><td><b>Service</b></td><td>jenkins-chat-approval</td></tr>
                              <tr><td><b>Build</b></td><td>#${BUILD_NUMBER}</td></tr>
                              <tr><td><b>Release</b></td><td>${releaseTs}</td></tr>
                              <tr><td><b>Branch</b></td><td>main</td></tr>
                              <tr><td><b>Commit</b></td><td>${commit}</td></tr>
                            </table>
                            <p style="margin-top:16px;">
                              <a href="${BUILD_URL}input"
                                 style="background:#4338ca;color:#ffffff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:bold;display:inline-block;">
                                 Review &amp; Approve Deployment
                              </a>
                            </p>
                        """,
                        mimeType: 'text/html'
                    )

                    timeout(time: 30, unit: 'MINUTES') {
                        def approver = input(
                            id: 'DeployApproval',
                            message: "Deploy jenkins-chat-approval build #${BUILD_NUMBER} (${releaseTs}) to production?\n\nCommit: ${commit}",
                            ok: 'Deploy to Production',
                            submitter: 'approver',
                            submitterParameter: 'APPROVED_BY'
                        )
                        def approvedAt = sh(script: 'date "+%Y-%m-%d %H:%M:%S %Z"', returnStdout: true).trim()
                        env.APPROVED_BY = approver
                        env.RELEASE_TS = releaseTs
                        echo "============================================================"
                        echo " PRODUCTION DEPLOYMENT APPROVED"
                        echo "   Service : jenkins-chat-approval"
                        echo "   Build   : #${BUILD_NUMBER} (${env.RELEASE_TS})"
                        echo "   Approver: ${env.APPROVED_BY}"
                        echo "   Time    : ${approvedAt}"
                        echo "============================================================"
                    }
                }
            }
        }

        // ── 7. Create Release Folder ────────────────────────────────────────────
        stage('Create Release') {
            steps {
                script {
                    env.RELEASE_DIR = "${DEPLOY_BASE}/releases/${env.RELEASE_TS}"
                    sh """
                        mkdir -p ${env.RELEASE_DIR}
                        cp index.js package.json package-lock.json ${env.RELEASE_DIR}/
                        cp jenkins.js jenkins.test.js ${env.RELEASE_DIR}/ 2>/dev/null || true
                        echo "Release folder ready: ${env.RELEASE_DIR}"
                    """
                }
            }
        }

        // ── 8. Install Production Dependencies ───────────────────────────────────
        stage('Install Prod Dependencies') {
            steps {
                sh """
                    cd ${env.RELEASE_DIR}
                    npm ci --omit=dev
                    echo "Production dependencies installed."
                """
            }
        }

        // ── 9. Switch Symlink ───────────────────────────────────────────────────
        stage('Switch Symlink') {
            steps {
                sh """
                    ln -sfn ${env.RELEASE_DIR} ${DEPLOY_BASE}/current
                    echo "Symlink: ${DEPLOY_BASE}/current → ${env.RELEASE_DIR}"
                """
                script { env.DEPLOYED = 'true' }
            }
        }

        // ── 10. PM2 Graceful Reload ────────────────────────────────────────────
        stage('PM2 Reload') {
            steps {
                sh """
                    PM2="\$(which pm2)"

                    STABLE_PATH="${DEPLOY_BASE}/current/index.js"
                    ECO="${DEPLOY_BASE}/current/ecosystem.config.cjs"

                    # Create ecosystem.config.cjs (always, to update with latest config)
                    mkdir -p \$(dirname "\$ECO")
                    cat > "\$ECO" << 'ECOEOF'
require('dotenv').config({ path: '${ENV_FILE}' });

module.exports = {
  apps: [
    {
      name: 'jenkins-chat-approval',
      script: '${DEPLOY_BASE}/current/index.js',
      cwd: '${DEPLOY_BASE}/current',
      instances: 1,
      exec_mode: 'fork',
      env_production: {
        NODE_ENV: 'production',
      },
      watch: false,
      max_memory_restart: '256M',
      error_file: '/var/log/pm2/jenkins-chat-approval-error.log',
      out_file: '/var/log/pm2/jenkins-chat-approval-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      restart_delay: 3000,
      max_restarts: 5,
      min_uptime: '10s',
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 15000,
    },
  ],
};
ECOEOF

                    RUNNING_PATH=\$(sudo \$PM2 jlist 2>/dev/null | python3 -c "
import sys, json
try:
    apps = json.load(sys.stdin)
    match = [a for a in apps if a['name'] == '${PM2_APP}']
    print(match[0]['pm2_env'].get('pm_exec_path', '') if match else 'absent')
except Exception:
    print('absent')
" || echo 'absent')
                    echo "Running script path: \$RUNNING_PATH"
                    echo "Stable script path:  \$STABLE_PATH"

                    if [ "\$RUNNING_PATH" = "\$STABLE_PATH" ]; then
                        sudo \$PM2 reload \$ECO --env production --update-env
                        echo "Graceful reload complete (new code via symlink)."
                    else
                        sudo \$PM2 delete ${PM2_APP} 2>/dev/null || true
                        sudo \$PM2 start \$ECO --env production
                        echo "Migrated PM2 onto stable symlink path (one-time restart)."
                    fi
                    sudo \$PM2 save
                    echo "PM2 process live."
                """
            }
        }

        // ── 11. Health Check ────────────────────────────────────────────────────
        stage('Health Check') {
            steps {
                script {
                    def healthy = false
                    for (int i = 1; i <= 12; i++) {
                        try {
                            def code = sh(
                                script: "curl -s -o /dev/null -w '%{http_code}' ${HEALTH_URL}",
                                returnStdout: true
                            ).trim()
                            if (code == '200' || code == '404') {  // 404 means service is up but no valid request
                                healthy = true
                                echo "Health check passed (attempt ${i}/12): HTTP ${code}"
                                break
                            }
                            echo "Attempt ${i}/12: HTTP ${code} — waiting 5s..."
                        } catch (Exception ignored) {
                            echo "Attempt ${i}/12: health check failed, retrying..."
                        }
                        sleep(5)
                    }
                    if (!healthy) {
                        error("Health check failed after 12 attempts — triggering rollback.")
                    }
                }
            }
        }

        // ── 12. Cleanup Old Releases ────────────────────────────────────────────
        stage('Cleanup Old Releases') {
            steps {
                sh """
                    cd ${DEPLOY_BASE}/releases
                    ls -dt */ | tail -n +6 | xargs -r rm -rf
                    echo "Retained last 5 releases. Current releases:"
                    ls -lth ${DEPLOY_BASE}/releases/
                """
            }
        }
    }

    post {
        success {
            emailext(
                to: "${env.NOTIFY_EMAIL}",
                subject: "[jenkins-chat-approval] Build #${BUILD_NUMBER} deployed successfully",
                body: """
                    <h2 style="color:#059669;">Deployment Successful</h2>
                    <table>
                      <tr><td><b>Service</b></td><td>jenkins-chat-approval</td></tr>
                      <tr><td><b>Build</b></td><td>#${BUILD_NUMBER}</td></tr>
                      <tr><td><b>Release</b></td><td>${env.RELEASE_TS ?: '—'}</td></tr>
                      <tr><td><b>Branch</b></td><td>main</td></tr>
                      <tr><td><b>Approved by</b></td><td>${env.APPROVED_BY ?: '—'}</td></tr>
                      <tr><td><b>Duration</b></td><td>${currentBuild.durationString}</td></tr>
                    </table>
                    <p><a href="${BUILD_URL}">View Build</a></p>
                """,
                mimeType: 'text/html'
            )
        }
        failure {
            script {
                if (env.DEPLOYED == 'true' && fileExists("${DEPLOY_BASE}/current")) {
                    sh """
                        PM2="\$(which pm2)"
                        # Get the previous release
                        PREV_RELEASE=\$(ls -d ${DEPLOY_BASE}/releases/*/ | sort -V | tail -2 | head -1)
                        if [ -n "\$PREV_RELEASE" ]; then
                            echo "Rolling back to: \$PREV_RELEASE"
                            ln -sfn \$PREV_RELEASE ${DEPLOY_BASE}/current
                            cd ${DEPLOY_BASE}/current
                            sudo \$PM2 reload ecosystem.config.cjs --env production --update-env 2>/dev/null || sudo \$PM2 start ecosystem.config.cjs --env production
                            sudo \$PM2 save
                            echo "Rollback complete → \$PREV_RELEASE"
                        fi
                    """
                }
            }
            emailext(
                to: "${env.NOTIFY_EMAIL}",
                subject: "[jenkins-chat-approval] Build #${BUILD_NUMBER} FAILED",
                body: """
                    <h2 style="color:#dc2626;">Deployment Failed</h2>
                    <table>
                      <tr><td><b>Service</b></td><td>jenkins-chat-approval</td></tr>
                      <tr><td><b>Build</b></td><td>#${BUILD_NUMBER}</td></tr>
                      <tr><td><b>Branch</b></td><td>main</td></tr>
                      <tr><td><b>Approved by</b></td><td>${env.APPROVED_BY ?: 'not yet approved'}</td></tr>
                      <tr><td><b>Rollback</b></td><td>${env.DEPLOYED == 'true' ? 'Automatic rollback executed' : 'No rollback needed (failed before deploy)'}</td></tr>
                    </table>
                    <p><a href="${BUILD_URL}console">View Console Log</a></p>
                """,
                mimeType: 'text/html'
            )
        }
        always {
            cleanWs()
        }
    }
}
