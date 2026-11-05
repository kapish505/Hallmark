# AI usage

Hallmark was built with an AI coding assistant (Claude Code, Anthropic), working from the team's build prompts
(`HALLMARK_BUILD_PROMPT` v2 and the privacy/accuracy add-on; not in the repo).

| Area | AI involvement | Human involvement |
|---|---|---|
| Build prompts | Research help while drafting | Written and owned by the team |
| Contracts (`contracts/src`) | Written by the AI from the prompt | Reviewed; deployed by the team via Remix |
| Foundry tests, parity-vector generator | Written by the AI | Reviewed |
| Services (`packages/*`), scripts | Written by the AI against the real SDK types (x402 2.28.0, ethers 6.13.1) | Reviewed |
| Local harness and fakes (`scripts/local`) | Written by the AI; the fakes are labelled local-only | Reviewed |
| Docs | Drafted by the AI | Edited by the team |

Problems the AI's own tests caught before any deployment: a tolerance-class `resolve` would have needed about 14.5M gas with the
nested-loop overlap (near Hedera's 15M limit), so overlap was rewritten as a hash table (708k gas at 96 × 96, fuzz-tested equal);
a harness flaw made "replay another input's output" coincidentally correct; anvil gas estimation under-estimates nested calls.

**Process disclosure.** A v1 prototype (a different design) was written by the AI **before the official kickoff**, at the
team's request, and was never committed. After the team confirmed kickoff, it was replaced in place by v2; git history starts
there. Modules carried over from v1, adapted, are listed in `docs/DECISIONS.md` (process note).

No AI output is presented as a measurement. Every number is tagged measured / assumed / cited.
