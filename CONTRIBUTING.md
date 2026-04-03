# Contributing

This repo is intended to support community contributions, especially around adapter coverage and client improvements.

## Ground Rules

- Keep app-specific logic inside `apps/`.
- Move reusable logic into `packages/`.
- Avoid duplicating adapter or API code across clients.
- Prefer small, reviewable pull requests.

## Before Opening a PR

1. Open or reference an issue when the change is non-trivial.
2. Keep the scope narrow.
3. Update the relevant README or docs when behavior changes.
4. Add or update tests once the test setup exists.

## Areas Expected to Grow First

- browser extension adapters
- shared scrobble payload validation
- title-resolution helpers
- client auth/session handling
