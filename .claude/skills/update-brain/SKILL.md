---
name: update-brain
description: Compact the current session and update the project knowledge base with new learnings and evidence.
---

# update-brain

Compact the current conversation and update the project's persistent knowledge base in the auto-memory directory.

## Memory Directory

All files live in the auto-memory directory:
`~/.claude/projects/-Users-abhishekjoseph-Documents-Code-order-validation-v3-8count/memory/`

## Steps

1. **Compact the session** — Analyze the full conversation and produce a compact summary capturing: key decisions made, problems solved, new patterns discovered, and any corrections to prior knowledge.

2. **Append to `context.md`** — This is the master context log that tracks every session. Add a new entry at the top with:
   ```
   ## Session — YYYY-MM-DD
   **Focus:** One-line summary of what the session was about
   **Key outcomes:**
   - Bullet points of what was accomplished
   **Decisions & learnings:**
   - Bullet points of decisions, discoveries, corrections
   ```
   If `context.md` does not exist, create it with a `# Session Context Log` header.

3. **Update topic knowledge base files** — Review the existing topic files (`MEMORY.md`, `architecture.md`, `calculators.md`, `testing-patterns.md`, `8count-business-logic.md`, etc.). For any new or changed knowledge from this session:
   - Update the relevant topic file with the new information.
   - **Add evidence** — Every fact added or updated in a topic file must include a brief evidence note showing where the information came from. Use this format inline or as a sub-bullet:
     ```
     - Some fact or pattern
       > Evidence: observed in `order.test.js` line 45; confirmed via Buildprint fetch_data on 2026-03-10
     ```
   - If no existing topic file fits, create a new one and link it from `MEMORY.md` under "Topic Files".

4. **Update `MEMORY.md`** — If the session produced changes to project structure, conventions, test suites, or any top-level summary info, update `MEMORY.md` accordingly. Keep it under 200 lines.

5. **Confirm** — Tell the user what was updated, listing each file modified or created.

## Rules

- Never duplicate information across topic files — each fact lives in one place.
- Most recent entries go at the top of `context.md`.
- Keep entries concise. Prefer bullets over paragraphs.
- If a session contradicts existing knowledge, update the old entry and note the correction with evidence.
- Do not remove existing knowledge unless it is confirmed wrong.
