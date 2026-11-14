---
description: Show the Dev Agency team (9 subagents), check they are loaded, and how to use them
---
Answer in the user's language, short and plain.

1. Check which of these subagent types are available in this session: architect, designer, frontend, backend, tester, reviewer, security, devops, docs. Report "loaded: N/9" and name any missing one. If any are missing, tell the user to close and reopen the Claude app and start a NEW session (agents load only at session start), and that install.ps1 puts them in ~/.claude/agents.
2. Show this table (one line each): architect = spec + PLAN.md; designer = UI/UX + DESIGN.md; frontend = React/Tailwind/HTML; backend = PHP/Node + SQL Server; tester = write/run tests; reviewer = review code; security = find vulnerabilities; devops = git/PR, deploy checklist, rollback (prepares, never executes); docs = README + diagrams.
3. Show 3 example prompts: "ให้ reviewer ตรวจไฟล์ X", "ทำระบบ ... " (big task: you scope it with me, write PLAN.md, wait for OK), "ให้ security ตรวจโฟลเดอร์ api/".
4. Say: small task = I do it myself; big task = scope first, then agents; nothing is deployed or changed in a database without an approval sheet. The live page is http://127.0.0.1:7788 (local sessions only).
Do not change any files.
