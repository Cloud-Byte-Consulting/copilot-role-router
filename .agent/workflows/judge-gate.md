# /judge-gate — run the role-router Judge verification gate

Run the role-router Judge verification gate on the most recently completed work.

1. Identify the user's ORIGINAL intent for the task just completed and summarize the
   work that was done.
2. Open the verification:

   ```bash
   node core/cli.mjs judge-open --intent "<original intent>" --work "<work summary>"
   ```

3. Adopt the **Judge** role (strictly read-only): inspect the real artifacts — the diff,
   changed files, recorded test/build output — and build a structured verdict with
   concrete evidence citations (file/line, test names, commits).
4. Finalize:

   ```bash
   node core/cli.mjs judge-finalize --id <verificationId> --json "<structured verdict JSON>"
   ```

5. OBEY the printed hill-climb directive exactly as described in `AGENTS.md`:
   - `CONTINUE_REFINE`: route gaps to the owning role, re-open with the same `--run-id`.
   - `STOP_BUDGET` / `STOP_PLATEAU` / `STOP_REVIEW`: escalate to the user; stop looping.
   - `STOP_ACCEPT`: proceed to the docs gate, then Scribe recording.
