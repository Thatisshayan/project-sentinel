# Closed-Loop E2E Smoke Test

Manual steps to prove the full push → audit → execute → PR → merge loop works on a real repo.

**Target repo:** `tapcash` (or any repo with GitHub Actions configured and Notion project linked)

---

## Steps

**1. Push a trivial commit**

```bash
cd your-local-tapcash
echo "# smoke test $(date)" >> SMOKE.md
git add SMOKE.md && git commit -m "chore: smoke test $(date)" && git push
```

**2. Verify webhook received**

In Telegram: `/sentinel webhook-status`  
Expected: `tapcash` shows in the last 24h events list

**3. Verify audit triggers**

Wait ~5 minutes for build poll to complete, then:  
In Telegram: `/sentinel audit tapcash`  
Expected: 5–10 tasks generated, confirmation message sent

**4. Verify execution**

In Telegram: `/sentinel execute tapcash`  
Expected: aider runs on top task, PR opened on `sentinel/batch-*` branch

**5. Merge the PR on GitHub**

Open the PR URL from Telegram, review, merge.

**6. Run the checker script**

```bash
DATABASE_URL=<your-production-db-url> TARGET_REPO=tapcash node backend/scripts/check-loop.js
```

Expected output: 4/4 checks passed, exit 0

---

## Exit criteria

The loop is proven when:
- `check-loop.js` exits 0
- `portfolio_metrics.last_commit_at` is non-null for `tapcash`
- At least one audit task is in `done` status
- Build poll job exists in DB

All of Phase 0 must pass before publishing.
