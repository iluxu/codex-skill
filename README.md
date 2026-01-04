# codex-skill

CLI to list, search, and install Codex skills from a registry.

## Install the CLI

```
npm install -g codex-skill
```

## Quick start (npx)

```
npx --yes codex-skill list
```

## Install a skill locally

```
npx --yes codex-skill install codex-theme
```

Installs to `~/.codex/skills` (or `$CODEX_HOME/skills`) by default. Restart Codex after installing.

## Registry override

```
REGISTRY_URL=https://raw.githubusercontent.com/iluxu/codex-skills-registry/main/index.json \
  npx --yes codex-skill list
```

## Local dev

```
npm install
npm run build
node dist/index.js list --registry ../codex-skills-registry/index.json
```

## Related repos

- Registry: https://github.com/iluxu/codex-skills-registry
- MCP server: https://github.com/iluxu/codex-skills-mcp
