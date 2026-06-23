# Contributing

## Workflow

1. Create a focused branch from `main`.
2. Keep platform and CRM changes separate when possible.
3. Run `npm run ci` before opening a pull request.
4. Update docs when architecture, migrations, module boundaries, permissions, or workflows change.

## Commit Style

Use concise, descriptive commit messages:

- `Initialize platform shell`
- `Add CRM lead schema`
- `Document approval workflow boundary`

## Pull Requests

Include:

- what changed
- how it was tested
- any migration or environment impact
- screenshots for meaningful UI changes

## Security

Never commit secrets, production exports, real customer data, OAuth tokens, or service-role keys.
