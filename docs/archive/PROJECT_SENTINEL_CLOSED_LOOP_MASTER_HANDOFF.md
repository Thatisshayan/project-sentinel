# PROJECT SENTINEL — CLOSED-LOOP AUTONOMOUS BUILD + GROUND TRUTH SYSTEM

## Purpose

Build Project Sentinel as a closed-loop project operating system.

This system must automatically keep every project’s ground truth updated when code changes, builds run, builds fail, and fixes are attempted.

The workflow must support all repositories listed in the Notion database.

The core loop is:

```text
Agent/coder commits code to GitHub
→ GitHub push triggers automation
→ build/deployment status is checked
→ Notion project ground truth updates automatically
→ changelog updates automatically
→ Telegram group receives a clear report
→ if build failed, debugger agent is triggered
→ debugger fixes the repo and commits again
→ loop repeats until build passes or retry limit is reached
```

The goal is:

```text
working code
working builds
clean repos
automatic changelogs
automatic Notion ground truth
Telegram visibility
automatic debugging on failed builds
no forgotten broken commits
```

---

## High-Level Architecture

Use a hybrid architecture:

```text
Pipedream = event triggers, routing, lightweight automation
Railway = always-online backend for debugger-agent orchestration
GitHub = source code, commits, branches, build/check status
Vercel/Railway/GitHub Actions = build/deployment status sources
Notion = ground truth project memory
Telegram = command/reporting center
OpenCode = first debugger/coder agent
Kilo CLI = second fallback debugger/coder agent
Kiro = third fallback debugger/coder agent
```

---

## Non-Negotiable Design Goal

Every repo in Notion should become:

```text
clean
neat
buildable
working
tracked
automatically updated
enjoyable for humans and agents to work with
```

This system must reduce chaos, not create more.

---

## Current Known Setup

### Notion

The Notion setup is already done.

Database:

```text
Projects Command Center
```

The database already contains project rows.

Each project row has:

```text
Repo Name
GitHub Repo URL
```

The Notion integration already has access.

Do not rebuild Notion.

Do not rename Notion pages.

Do not delete Notion pages.

Do not restructure Notion without approval.

### Known Repo Name Values

Known Notion `Repo Name` values include:

```text
acc
AlphonsoEcosystem
shiporex
agents-ops-board
aegis
tapcash
session-guard
founder-social-club
costpilot
mint
obsidian-studio
obsidian-media
```

The workflow must support **all repos in the Notion database**, not just one repo.

Repo matching must be case-insensitive.

Example:

```text
GitHub repo: Tapcash
Notion Repo Name: tapcash
```

These must match.

Use logic equivalent to:

```js
githubRepoName.toLowerCase() === notionRepoName.toLowerCase()
```

---

## Ground Truth Definition

“Ground truth” means the Notion project row/page should always reflect the current operational truth of the project.

For every repo/project, Notion should be automatically updated with:

```text
latest commit
latest branch
latest author
latest commit URL
changed files
basic summary of what changed
risk level
latest build/deployment status
build provider
build URL/log URL if available
failure reason if build failed
debug attempt count
last debugger used
last fix commit
current project state
changelog entry
```

The agent must not manually write project updates into Notion as normal notes.

Notion must be updated automatically from GitHub/build/deployment events.

---

# PART 1 — CORE GITHUB → BUILD STATUS → NOTION → TELEGRAM LOOP

## Goal

When a commit is pushed to a repo, the system must:

1. Receive GitHub push event.
2. Extract repo and commit details.
3. Match repo to Notion project using `Repo Name`.
4. Check build/deployment status from:
   - GitHub Actions/checks
   - Vercel
   - Railway
5. Update Notion ground truth.
6. Append changelog entry.
7. Send Telegram report.
8. If build failed, trigger debugger loop.

---

## Main Flow

```text
GitHub push event
        ↓
Pipedream receives event
        ↓
Extract repo/commit/files/author/branch
        ↓
Find matching Notion project by Repo Name
        ↓
Wait/poll for build status from GitHub/Vercel/Railway
        ↓
Update Notion ground truth
        ↓
Append changelog
        ↓
Send Telegram report
        ↓
If build failed → trigger Railway debugger backend
```

---

## Trigger Strategy

Preferred:

```text
One shared GitHub webhook endpoint
```

All repos in Notion should eventually send push events to the same Pipedream webhook.

Alternative:

```text
Pipedream GitHub trigger per repo
```

Use the shared webhook if possible.

If using per-repo triggers, document exactly how to add all repos.

---

## GitHub Event Data to Extract

From each push event, extract:

```text
repoName
repoNameLower
repoFullName
repoUrl
branchName
ref
commitMessage
commitHash
commitUrl
authorName
authorEmail if available
commitTimestamp
changedFiles
changedFilesText
filesChangedCount
addedFiles
modifiedFiles
removedFiles
commitCount
pusherName
pusherEmail if available
```

Use:

```text
payload.head_commit
```

when available.

If missing, use the latest commit from:

```text
payload.commits
```

For changed files, combine:

```text
added
modified
removed
```

Branch extraction:

```text
refs/heads/main → main
```

---

## Main Branch Rule

The user wants commits to land on `main` so Vercel/Railway/GitHub builds actually run and failures are visible.

This system must support main-branch build validation.

However, safety guardrails are required.

### Allowed

For normal project automation:

```text
commit to main
push to main
trigger build
detect failure
debug and push fix to main
repeat up to retry limit
```

### Required Guardrails

Do not push dangerous changes to main without stopping and reporting:

```text
secret/token changes
.env value changes
auth/security changes
payment/billing changes
database migration/destructive schema changes
large refactors
dependency lockfile replacement with suspicious changes
deleting large parts of repo
force push
history rewrite
branch protection changes
```

If such changes are involved, stop and send Telegram:

```text
High-risk change detected. Human review required before automatic main push/fix.
```

---

# PART 2 — BUILD STATUS CHECKING

## Required Build Sources

Check build/deployment status from:

```text
GitHub Actions / GitHub Checks
Vercel
Railway
```

The system should detect which providers apply to each repo.

Do not assume every repo uses all providers.

---

## Build Status States

Normalize all providers into one status:

```text
pending
success
failed
cancelled
unknown
not_configured
```

---

## Build Status Timing

After a push, builds may take time.

The workflow must wait/poll.

Recommended:

```text
initial wait: 30–60 seconds
poll interval: 30–60 seconds
max wait: 10–15 minutes
```

If status is still pending after max wait:

```text
Build status: pending_timeout
```

Update Notion and Telegram accordingly.

---

## GitHub Actions / Checks

Use GitHub API to check:

```text
check suites
check runs
workflow runs
commit statuses
```

for the pushed commit SHA.

Collect:

```text
provider: GitHub Actions
status
conclusion
workflow name
run URL
failed job name if available
error/log URL if available
```

---

## Vercel

If repo/project is connected to Vercel, check latest deployment for the commit.

Collect:

```text
provider: Vercel
deployment status
deployment URL
inspect/log URL if available
project name
commit SHA
failure reason if available
```

---

## Railway

If repo/project is connected to Railway, check latest deployment/build for the commit.

Collect:

```text
provider: Railway
deployment status
service/project name
deployment URL/log URL if available
commit SHA
failure reason if available
```

---

## Overall Build Status

Combine statuses.

If any required provider failed:

```text
overallBuildStatus = failed
```

If all configured providers succeeded:

```text
overallBuildStatus = success
```

If no provider is configured:

```text
overallBuildStatus = not_configured
```

If unknown:

```text
overallBuildStatus = unknown
```

If still pending after max wait:

```text
overallBuildStatus = pending_timeout
```

---

# PART 3 — NOTION GROUND TRUTH UPDATE

## Notion Matching

Search:

```text
Projects Command Center
```

Match:

```text
Repo Name
```

to GitHub repo name case-insensitively.

If no match:

1. Do not update Notion.
2. Send Telegram warning.
3. Log safely.

Telegram warning:

```text
Project Sentinel warning ⚠️

Unknown repo received: [repo name]
Branch: [branch]
Repo URL: [repo URL]
Commit: [commit message]

No matching Notion project was found.
Check the Repo Name field in Notion.
```

---

## Required Notion Field Updates

Update these fields if they exist:

```text
Last Commit Message ← commitMessage
Last Commit Hash ← commitHash
Last Commit URL ← commitUrl
Last Branch ← branchName
Last Commit Author ← authorName
Last Commit Date ← commitTimestamp
Changed Files ← changedFilesText
Files Changed Count ← filesChangedCount
Last Updated ← current timestamp
AI Summary ← deterministic/basic summary or future AI summary
Risk Level ← computed risk level
CI Status ← GitHub Actions/check status if available
Deployment Status ← overall build/deploy status
Production Status ← success/failed/pending if field exists
Build Provider ← GitHub Actions / Vercel / Railway / Multiple
Build URL ← most relevant build/deployment URL
Last Build Error ← short error reason if failed
Last Debug Attempt Count ← debug attempt count if available
Last Debugger Used ← OpenCode / Kilo CLI / Kiro if used
Last Fix Commit URL ← fix commit if debugger commits
```

Skip missing optional fields safely.

Do not fail the workflow because an optional Notion property does not exist.

---

## Changelog Append

Append an entry to the matching Notion project page.

Format:

```text
Project Sentinel Update

Date: [timestamp]
Project: [project name]
Repo: [repo name]
Branch: [branch]
Commit: [commit hash]
Author: [author]
Message: [commit message]
Files Changed: [count]
Risk: [risk level]
Build Status: [overall build status]
Build Provider: [provider]
Build URL: [url]
Marketing Update: [Yes/No]
Debugger Triggered: [Yes/No]
Debugger Used: [OpenCode/Kilo/Kiro/None]
Fix Commit: [url or None]
```

If changelog append fails:

- Do not fail the whole workflow.
- Continue to Telegram.
- Telegram must say:

```text
Database updated, changelog append failed.
```

---

# PART 4 — TELEGRAM REPORTING

## Telegram Report After Every Push

Send to group:

```text
Project Sentinel update ✅/❌/⚠️

Project: [project name]
Repo: [repo name]
Branch: [branch]
Commit: [commit message]
Author: [author]
Files changed: [count]
Risk: [risk level]

Build status: [success/failed/pending/unknown/not_configured]
Provider: [GitHub Actions/Vercel/Railway/Multiple]
Build URL: [link if available]

What changed:
[basic summary]

Notion updated: Yes/No
Changelog appended: Yes/No

Debugger triggered: Yes/No
Retry attempt: [number if applicable]

Commit URL: [commit URL]
```

---

## Telegram Report When Build Fails

If build failed:

```text
Project Sentinel build failed ❌

Project: [project name]
Repo: [repo name]
Branch: [branch]
Commit: [commit message]
Build provider: [provider]
Build URL: [link]
Failure reason: [safe summary]

Debugger will start.
Debugger order:
1. OpenCode
2. Kilo CLI
3. Kiro

Retry attempt: [number]/5
```

---

## Telegram Report When Debugger Fixes

```text
Project Sentinel debugger update 🛠️

Project: [project name]
Repo: [repo name]
Debugger: [OpenCode/Kilo CLI/Kiro]
Attempt: [number]/5

Fix committed: Yes
Fix commit: [url]
Build will run again.
```

---

## Telegram Report When Retries Exhausted

```text
Project Sentinel needs human help 🚨

Project: [project name]
Repo: [repo name]
Branch: [branch]
Original failed commit: [url]
Attempts used: 5/5
Last debugger: [debugger]
Last error: [safe summary]

Automatic repair stopped.
Human review required.
```

---

# PART 5 — DEBUGGER LOOP

## Goal

If build fails, automatically trigger a debugger/coder agent to fix the repo.

Debugger order:

```text
1. OpenCode
2. Kilo CLI
3. Kiro
```

The debugger loop continues until:

```text
build passes
```

or:

```text
5 retry attempts are used
```

---

## Retry Limit

Max retries:

```text
5
```

Retry count must be tracked per failed commit/repo.

Store retry state in one of:

```text
Railway database
Pipedream data store
Notion fields
GitHub issue/comment
```

Preferred:

```text
Railway backend database or durable store
```

---

## Debugger Trigger Conditions

Trigger debugger only if:

```text
overallBuildStatus = failed
```

Do not trigger debugger if:

```text
success
pending
pending_timeout
unknown
not_configured
cancelled
```

For pending_timeout or unknown, send Telegram warning and stop.

---

## Debugger Backend

Railway should host the always-online debugger orchestration backend.

Backend responsibilities:

```text
receive failed build payload
select debugger agent
clone/pull repo
inspect failure context
run install/build/test locally if possible
apply minimal fix
commit to main if safe
push to GitHub
return status to Pipedream/Telegram
track retry count
stop after 5 attempts
```

---

## Debugger Input Payload

When triggering debugger, send:

```json
{
  "projectName": "...",
  "repoName": "...",
  "repoFullName": "...",
  "repoUrl": "...",
  "branchName": "main",
  "commitHash": "...",
  "commitUrl": "...",
  "commitMessage": "...",
  "authorName": "...",
  "changedFiles": ["..."],
  "buildProvider": "...",
  "buildStatus": "failed",
  "buildUrl": "...",
  "failureReason": "...",
  "logsUrl": "...",
  "retryAttempt": 1,
  "maxRetries": 5
}
```

---

## Debugger Agent Order

### Attempt With OpenCode First

OpenCode should be the first debugger.

OpenCode instructions:

```text
You are debugging a failed build.
Find the smallest safe fix.
Do not refactor unnecessarily.
Do not change secrets.
Do not change billing/auth/payment/database logic unless clearly required and safe.
Run relevant tests/build locally if possible.
Commit fix to main only if safe.
Push to GitHub.
Report exact changes.
```

### Fallback to Kilo CLI

If OpenCode fails, cannot run, or cannot fix:

Use Kilo CLI.

### Fallback to Kiro

If Kilo CLI fails:

Use Kiro.

### Stop Condition

Stop after:

```text
5 total attempts
```

Then require human help.

---

## Main Branch Debugging Rule

The user wants fixes to go to main because builds run from main.

Therefore debugger may commit/push to main **only if safe**.

Before pushing to main, debugger must check:

```text
current branch is main
repo status is clean except intended changes
no secrets are modified
no destructive file deletion
no force push
no branch protection bypass
commit message is clear
```

Commit message format:

```text
fix(project-sentinel): repair failed build after [provider] failure
```

or:

```text
fix: resolve build failure from [short cause]
```

---

## High-Risk Stop Rules

Do not auto-fix/push to main if failure appears related to:

```text
secrets
environment values
production database
payment/billing
auth/security policy
destructive migration
missing paid service config
account permission issue
external provider outage
```

Instead send Telegram:

```text
Project Sentinel stopped automatic repair because the failure appears high-risk or environment-related.
Human review required.
```

---

# PART 6 — TELEGRAM COMMAND CENTER

## Goal

Telegram group should become the project command center.

Commands should be supported after the core loop works.

---

## Required Commands

```text
/sentinel help
/sentinel status <project>
/sentinel repos
/sentinel project <project>
/sentinel builds <project>
/sentinel retry <project>
/sentinel stop <project>
/sentinel branches <project>
/sentinel prs <project>
/sentinel cleanup-branches <project>
/sentinel audit <project>
/sentinel fix <project> <task>
```

---

## Command Details

### `/sentinel help`

Return available commands.

### `/sentinel status <project>`

Return from Notion:

```text
Project
Repo Name
Last Commit
Last Branch
Last Build Status
Deployment Status
Risk Level
Last Updated
Current Focus if available
Blockers if available
```

### `/sentinel repos`

List all tracked repos from Notion:

```text
Project Name — Repo Name — GitHub URL
```

### `/sentinel project <project>`

Return project details from Notion.

### `/sentinel builds <project>`

Return latest build/deployment status from:

```text
GitHub Actions
Vercel
Railway
```

### `/sentinel retry <project>`

Manually trigger debugger retry for latest failed build.

Respect retry limit.

### `/sentinel stop <project>`

Stop automatic retries for a project.

### `/sentinel branches <project>`

List branches.

### `/sentinel prs <project>`

List PRs.

### `/sentinel cleanup-branches <project>`

Report stale/merged branches.

Do not delete automatically unless a separate confirmation command is implemented.

### `/sentinel audit <project>`

Create an audit task or issue.

Do not change code directly.

### `/sentinel fix <project> <task>`

Create a fix task and optionally trigger debugger/coder agent.

Do not make high-risk changes without confirmation.

---

# PART 7 — BRANCH AND REPO HYGIENE

## Goal

No abandoned branches.

No forgotten code.

No invisible work.

No stale failed builds.

---

## Branch Hygiene Report

Project Sentinel should produce:

```text
Project Sentinel branch report

Repo: [repo]
Default branch: main
Active branches: [count]
Open PRs: [count]
Merged branches safe to delete: [count]
Stale branches over 14 days: [count]

Action needed:
- Review stale branch: [branch]
- Delete merged branch: [branch]
- Finish PR: [PR]
```

---

## Branch Cleanup Safety

Do not delete branches automatically in the first implementation.

Only report.

Future deletion requires explicit confirmation.

Never delete:

```text
main
master
production
staging
develop
release/*
protected branches
branches with open PRs
branches with unmerged commits
```

---

# PART 8 — REQUIRED SECRETS

Store all secrets securely.

Use:

```text
Pipedream connected accounts
Pipedream environment variables
Railway environment variables
platform secret stores
```

Do not use:

```text
hardcoded tokens
tokens in markdown
tokens in workflow notes
tokens in console logs
tokens in Notion
```

---

## Required Secrets

```text
GITHUB_TOKEN
GITHUB_WEBHOOK_SECRET
NOTION_TOKEN
NOTION_DATABASE_ID
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

For build status:

```text
VERCEL_TOKEN
RAILWAY_TOKEN
```

For debugger backend:

```text
RAILWAY_SERVICE_URL
DEBUGGER_SHARED_SECRET
```

For future AI:

```text
DASHSCOPE_API_KEY
OPENAI_API_KEY
```

Do not use future AI keys until explicitly enabled.

---

# PART 9 — SECURITY RULES

## Absolute No

Do not:

```text
expose secrets
print secrets
write secrets to Notion
hardcode tokens
force push
rewrite history
disable branch protection
delete Notion pages
rename Notion pages
rename GitHub repos
change billing settings
create paid services without approval
```

---

## Human Approval Required

Require human approval for:

```text
secrets/env changes
auth/security changes
payment/billing changes
database migrations
production destructive changes
large refactors
branch deletion
changing branch protection
manual deployment overrides
```

---

# PART 10 — TEST PLAN

## Test 1 — GitHub Push Trigger

Make harmless commit:

```text
sentinel-test.md
```

Commit message:

```text
test: trigger project sentinel
```

Confirm workflow receives event.

---

## Test 2 — Notion Matching

Confirm repo matches correct Notion row using `Repo Name`.

Case-insensitive matching must work.

---

## Test 3 — Notion Ground Truth Update

Confirm fields update:

```text
Last Commit Message
Last Commit Hash
Last Commit URL
Last Branch
Last Commit Author
Last Commit Date
Changed Files
Files Changed Count
Last Updated
Risk Level
Deployment Status
CI Status
```

---

## Test 4 — Changelog Append

Confirm changelog append works.

If it fails, confirm workflow still completes and Telegram reports append failure.

---

## Test 5 — Telegram Report

Confirm Telegram group receives full report with:

```text
project name
repo name
branch
commit message
what changed
build status
build provider
build URL
Notion update status
debugger status
```

---

## Test 6 — Build Status Success

Push a commit that builds successfully.

Confirm Telegram says success.

Confirm Notion says success.

---

## Test 7 — Build Status Failure

Create or simulate a controlled failing build.

Confirm:

```text
Notion updates failure
Telegram reports failure
debugger backend is triggered
retry count starts
```

---

## Test 8 — Debugger Retry Loop

Confirm debugger tries up to 5 times.

Confirm each fix commit triggers the loop again.

Confirm it stops after 5 attempts if unresolved.

---

## Test 9 — Unknown Repo

Simulate unknown repo.

Confirm Telegram warning.

---

## Test 10 — High-Risk Stop

Simulate failure involving `.env`, auth, payment, database, or secrets.

Confirm debugger stops and requests human review.

---

# PART 11 — DEFINITION OF DONE

The system is done when:

```text
All repos in Notion can be routed by Repo Name
GitHub push triggers workflow
Build status is checked from GitHub/Vercel/Railway where configured
Notion ground truth updates automatically
Changelog updates automatically or fails gracefully
Telegram group receives full reports
Build failures trigger debugger backend
Debugger order is OpenCode → Kilo CLI → Kiro
Retry limit is 5
Fix commits trigger the loop again
High-risk failures stop for human review
No secrets are exposed
A clear scaling/add-repo process is documented
```

---

# FINAL REPORT REQUIRED

When finished, provide:

```text
Project Sentinel Final Status

1. Workflow platform:
2. Backend platform:
3. Workflow name:
4. Trigger type:
5. Repos connected:
6. Notion database used:
7. Notion fields mapped:
8. Telegram group connected: Yes/No
9. GitHub Actions status check: Yes/No
10. Vercel status check: Yes/No
11. Railway status check: Yes/No
12. Test repo:
13. Test commit URL:
14. Build status result:
15. Notion update result:
16. Changelog append result:
17. Telegram alert result:
18. Debugger backend status:
19. Debugger agent order configured:
20. Retry limit configured:
21. High-risk stop rules implemented:
22. Secrets storage method:
23. What is fully working:
24. What is not finished:
25. Exact next step:
```

---

# FINAL INSTRUCTION TO BUILD AGENT

Start from this document as the source of truth.

Do not assume prior conversation.

Do not ask unnecessary questions.

If a token, permission, account connection, repo access, or platform URL is missing, state exactly:

```text
Platform:
Screen:
Field:
Value needed:
Why it is needed:
```

Build the system in the safest working order:

```text
1. Core GitHub push trigger
2. Notion ground truth update
3. Telegram report
4. Build status checks
5. Failed build debugger trigger
6. Retry loop
7. Telegram commands
8. Branch/repo hygiene reporting
```

The final system must create a reliable loop:

```text
commit → build → Notion update → Telegram report → failed build debugger → fix commit → build again
```

No secrets exposed.

No silent failures.

No abandoned broken builds.

No unmanaged repos.
