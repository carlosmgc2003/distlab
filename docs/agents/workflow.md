# Unattended Agent Workflow

How an agent session implements one GitHub issue with nobody available to
answer questions until the pull request is reviewed. The maintainer triages
issues and reviews pull requests; agents do everything in between.

DistLab is an educational side project with no production users. The process is
deliberately light: CI, the golden digests, the boundary test, and one human
review before merge are the safety net.

## Roles

| Who | Does | Never does |
| --- | --- | --- |
| Maintainer | Triages issues, applies `ready-for-agent`, starts sessions, reviews, merges | — |
| Agent | Picks one ready issue, implements it, verifies it, opens a pull request, fixes CI and review comments | Merges, pushes to `main`, closes issues by hand, changes an ADR's decision |

## What makes an issue ready for an agent

An issue gets `ready-for-agent` only when all of these hold:

- It uses the `distlab-task` template and every section is filled in.
- Every acceptance criterion is verifiable by a test or a command.
- *Architecture decision impact* is not "Unsure — architecture review required".
- *Dependencies* lists every blocking issue, or says `None`.
- Success does not depend on taste: copy, layout, or visual judgment calls go to
  `ready-for-human`, or the issue is split so the subjective part is separate.

The labels and their meaning are in [triage-labels.md](triage-labels.md).

## Picking work

When the session prompt names an issue, take that issue, but still check the
rules below. If it fails them, follow [Stop rules](#stop-rules).

Otherwise compute the **frontier**: open issues that

1. carry `ready-for-agent`,
2. have no assignee,
3. have every issue in their *Dependencies* section closed, and no open
   native blocker (`issue_dependencies_summary.blocked_by` is 0), and
4. have no open pull request that closes them.

"Benefits from #n" in *Dependencies* is not a blocker. Among frontier issues,
follow the epic's *Suggested order*, then sub-issue order, then the lowest
number.

**Claim** the issue as the session's first write: assign it to the repository
owner (sessions act with the owner's GitHub identity, so an assignee means
"taken") and comment `Claimed by an agent session: <session link>`.

### Work-in-progress limit

- At most two open pull requests from agents at any time.
- Do not start an issue whose dependency has an open, unmerged pull request.
  Stacked pull requests cost more review time than they save.

## Implementing

1. Read `CONTEXT.md`, then every specification, ADR, and file the issue's
   *Context* section names.
2. Work on the branch the session designates. Without one, use
   `agent/<issue>-<short-slug>`.
3. Implement the *Scope* and nothing else. *Out of Scope* is a hard limit.
4. Write the tests listed in *Tests*. Where acceptance criteria have IDs
   (`ARCH-AC-1`, `OVL-AC-1`), put the ID in the test name so review can trace
   each criterion to a test.
5. Update the specification or documentation named in *Scope* when a contract or
   behavior changes, and both design documents when a stated guarantee changes
   (see `AGENTS.md`).
6. Keep commits focused, with short imperative subjects.

Anything worth fixing that is outside the scope becomes a new issue with
`needs-triage` that uses the template, and is listed under *Follow-ups* in the
pull request. It is not fixed in this pull request.

## Stop rules

There is nobody to ask, so `AGENTS.md`'s "ask instead of inventing" becomes a
written question and a stop. Stop instead of guessing when:

- specifications or ADRs conflict, or a needed contract name or shape is missing;
- the change would contradict an ADR (follow `domain.md` "Flag ADR conflicts");
- an acceptance criterion cannot be met without leaving *Scope*;
- a dependency turns out not to be merged or not to provide what the issue expects;
- golden digests or packaged lesson exports change and the issue does not say
  behavior changes;
- verification cannot run in the environment;
- the change grows to roughly twice the size the issue suggests.

To stop:

1. Comment on the issue with what was done, the exact question, the options you
   see, and the one you recommend.
2. Replace `ready-for-agent` with `needs-info` and remove the assignee.
3. If the partial work is useful, push the branch and open a **draft** pull
   request whose description starts with `Blocked on a question in #<issue>`.
   Otherwise open no pull request.

## Verification before the pull request

Run, and report the result of each in the pull request:

```sh
npm run typecheck
npm test                 # unit, golden, boundary, worker, and browser tests
git diff --check
```

`npm test` already covers `test:boundaries`, the golden digest checks, and the
Playwright tests. For a change that cannot affect the browser, the package tests
and the web unit tests are enough:

```sh
npm test -w @distlab/contracts && npm test -w @distlab/kernel && npm test -w @distlab/scenario && npm test -w @distlab/catalogs
(cd apps/web && node --test --experimental-strip-types tests/*.test.ts)
```

For a UI change, also list the states the reviewer should look at in the
browser preview.

## Pull request

- Open one pull request per issue, as ready for review only when verification
  passes. The body follows `.github/pull_request_template.md` and contains
  `Closes #<issue>`.
- Fill in *Assumptions and decisions* honestly: it is the first section the
  reviewer reads.
- Subscribe the session to the pull request's activity and fix CI failures and
  review comments that stay within the issue's scope. Never skip or weaken a test
  to make CI pass.

## Starting sessions (maintainer)

One issue, from the Claude app or a scheduled task:

```text
Implement issue #<n> in carlosmgc2003/distlab following docs/agents/workflow.md.
Open a pull request when verification passes and watch it for CI failures.
```

Next issue from the frontier:

```text
Pick the next issue from the frontier defined in docs/agents/workflow.md,
respecting the work-in-progress limit, and implement it following that document.
If nothing is on the frontier, say so and stop.
```

Independent frontier issues can run in parallel sessions, within the
work-in-progress limit.

## Review checklist (maintainer)

- [ ] *Assumptions and decisions* are acceptable, or answered in a review comment.
- [ ] Every acceptance criterion maps to a test or a stated check.
- [ ] The diff stays inside *Scope*; follow-ups became issues.
- [ ] ADR impact is as the issue declared; golden digests are unchanged unless intended.
- [ ] CI is green; UI changes look right in the preview.

## Skills

The `/triage`, `/wayfinder`, `/grill-with-docs`, and `/domain-modeling` skills
mentioned in these documents are installed on the maintainer's machine, not in
this repository, so cloud sessions do not have them. This workflow does not
depend on them.
