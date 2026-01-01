# codex-skill

CLI to list, search, and install Codex skills from a registry.

## Quick start (npx)

```
npx --yes git+ssh://git@github.com/iluxu/codex-skill.git list \
  --registry https://raw.githubusercontent.com/iluxu/codex-skills-registry/main/index.json
```

## Install a skill locally

```
npx --yes git+ssh://git@github.com/iluxu/codex-skill.git install codex-theme \
  --registry https://raw.githubusercontent.com/iluxu/codex-skills-registry/main/index.json \
  --to ~/.codex/skills
```

Restart Codex after installing.

## Local dev

```
npm install
npm run build
node dist/index.js list --registry ../codex-skills-registry/index.json
```

## Related repos

- Registry: https://github.com/iluxu/codex-skills-registry
- MCP server: https://github.com/iluxu/codex-skills-mcp
