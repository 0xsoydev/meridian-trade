# Contributing

## Every prompt starts with this

> Write a production grade implementation plan/fix whichever applies
> Avoid abstractions unless ABSOLUTELY necessary
> Write type safe code
> NO comments in codebase

> @ponytail ultra mode

`@ponytail ultra` is a behaviour mode: delete before you add, prefer the standard library, no abstraction with one implementation, question the requirement before building it.

Install the ponytail skill (https://github.com/DietrichGebert/ponytail) and trail (`npm i -g @trailhq/trail-code`). Run `trail map` to orient and `trail callers <symbol>` before changing a shared function.

## Branching

- `develop` is the integration branch. `main` is release only. Only the lead merges `develop` into `main`.
- Never commit directly to `main` or `develop`. Every change starts on a feature branch off `develop`.
- Start from a fresh `develop` every time:

```sh
git switch develop
git pull
git switch -c feat/<area>-<short-name>
```

- Name branches `feat/router-settle`, `feat/perp-market`, `fix/topup-replay`, `chore/env-example`.
- One feature per branch, under a day. If it grows, split it.
- Bring `develop` into your branch before opening the PR.
- PR into `develop`, get one review, merge it yourself, delete the branch.
- Never force-push `develop` or `main`.

## Before you commit

Verify end to end that what you just implemented works as intended, and introduces no breaking change or unintended behavioural change.

- Run the real path, not just the unit test.
- Follow every caller with `trail callers <symbol>` or grep, then re-check the sibling paths you did not touch.
- Prove the contract did not move: request fields, response fields, status codes, database columns, env names, signatures. If one changed on purpose, update the handoff and tell the consumers.
- Check invariants after your path: balance, reserved, capacity, listing status, no `open` usage rows.
- Migrations are forward-only and safe to run twice.
- Contracts: `forge test` plus one call against the deployed address.
- UI: click it with data, with no data, and with no wallet.
- Nothing embarrassing in the diff: no `.env`, no keys, no debug prints, no commented-out code, no build output.
- Put the evidence in the PR: one line per check, and one line for anything unverified.

A feature that works in isolation but breaks the demo path is not done. If you cannot verify it end to end, say so in the PR.

## Before you open a PR

- `pnpm typecheck` passes
- `pnpm build` passes
- `forge test` passes if you touched `contracts/`
- The "done when" line in your handoff is true
- Non-trivial logic has one runnable check

## Code rules

- No comments. If a line needs explaining, rename it or simplify it.
- No `any`. External data enters as `unknown` and leaves through zod.
- Money and token counts are `bigint`. No floats in a money path.
- Validate at every trust boundary.
- No abstraction with one implementation.
- Delete before you add.

## Coordination

- Post when you start a branch and when you open a PR.
- Blocked more than 15 minutes on someone else's interface? Say it with the exact thing you need.
- Do not edit files another person owns.
- If you will miss a deliverable, say it early and name what you are cutting. Every handoff has a cut order.
- The demo path freezes at T+26. After that, fixes only.

## House rules

- The preflight suite lives outside this repo. ETHGlobal disqualifies project code written before kickoff.
- AI tool use is disclosed in the README.
