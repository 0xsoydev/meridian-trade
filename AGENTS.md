# AGENTS.md

## Purpose

Mandatory rules for any AI coding agent in this repository. Humans: see `CONTRIBUTING.md` for the branch model, review process and definition of done. `docs/plan.md` is the spec.

## Scope and precedence

- Applies to every file in the repository.
- A subfolder `AGENTS.md` (for example `apps/web/AGENTS.md`) may add stricter rules.
- When rules conflict, the stricter rule wins.

## Secrets — non-negotiable

Never read, print, summarise, diff or transform any of these:

`.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`, `secrets.*`, `.npmrc`, `.aws/*`, `.ssh/*`

- Never put a secret in chat, a log, a commit message, code or a comment.
- Never ask anyone to paste a secret.
- Reference environment variable names only, never values.
- No real key belongs in this repository. Test credentials live outside it.
- If a secret is exposed, stop, say so, recommend immediate rotation, and continue only after confirmation.

## Environment

- Do not open `.env*` files. The single exception is `.env.example`, which must contain names and placeholders only.

## Git

- Never run `git reset --hard`, `git checkout --`, `rm -rf` or a force-push unless explicitly asked.
- Never rewrite history.
- Never commit secrets, `node_modules`, `.next`, or build output.
- Feature work starts on a branch off `develop` and merges back into `develop`. Only the lead merges `develop` into `main`.
- Keep commits focused. One concern per commit.

## Editing

- Make the smallest change that solves the problem. Preserve the architecture in `docs/plan.md` unless asked to change it.
- Update docs when behaviour or setup changes. Add one runnable check when logic changes; money paths always.
- No comments, no debug prints, no commented-out code in a commit.

## Commands

- Read-only inspection first.
- Explain before anything destructive, long-running or paid.
- Ask before spending money or calling a production endpoint.
- Do not use tools to move repository data anywhere.

## Reporting

- Give exact file paths.
- State what you validated and what you did not.
- If blocked, say exactly what is blocked and give the safe next step.

## Default workflow

1. Understand the request and the constraint it touches.
2. Get context from the trail graph before grepping or opening files.
3. Make the minimal change.
4. Validate: `pnpm typecheck`, `pnpm build`, and `forge test` when contracts changed.
5. Report paths, checks run, and remaining risks.

<!-- trail:start -->
## Trail — repo context graph

This repo is indexed in `.trail/cache/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `trail map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

- Run `trail ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `trail grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `trail skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `trail callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `.trail/cache/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `trail ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `trail build` (deterministic,
no API key, $0).
<!-- trail:end -->
