# Working guidelines

- Read `PROJECT.md` and [the task brief](docs/gymnation-task.md) for scope and exact requirements.
- Build in small steps and explain decisions so the applicant can change the code in the interview.
- Reuse existing code; keep billing calculations shared with reconciliation.
- Test money, dates, validation, and concurrency against the brief.
- Keep documentation short. After each meaningful development pass, add a brief summary to `PROMPTS.md` covering the request, implementation decisions, and verification or blockers. Quote the relevant user development prompts exactly in the request section; for a longer chat, group those prompts under the development pass they informed. Summarize assistant work rather than copying responses. Label the record as summaries, not a transcript. Exclude side chats, workflow discussions, routine progress updates, tool output, and commit suggestions. Do not add entries for documentation-only side chats.
- Change this file only for lasting working rules; keep progress in `PROJECT.md` and run instructions and assumptions in `NOTES.md`.
- Run available checks yourself and report what passed or remains blocked.
- Review all uncommitted changes and offer five complete commit-message options. Do not commit, push, or submit unless asked.
