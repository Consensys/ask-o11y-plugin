# Troubleshooting Guide

- **[Grafana Cloud Users](#grafana-cloud-users)**
- **[Self-Hosted / Docker Users](#self-hosted--docker-users)**
- **[Common Issues (All Deployments)](#common-issues-all-deployments)**

---

## Grafana Cloud Users

### Plugin Not Appearing

1. Go to **Administration → Plugins and data → Plugins**, search for "Ask O11y", confirm it's installed
2. You need at least **Viewer** role
3. Hard reload: `Ctrl+Shift+R` / `Cmd+Shift+R`

### LLM Not Responding

1. Verify the Grafana LLM plugin is installed and enabled under **Administration → Plugins and data → Plugins**
2. Check your AI provider API key is set in **Configuration → Plugins → Grafana LLM**
3. Check your API key has remaining credits/quota at your provider's console
4. Check browser console (`F12`) for errors related to "llm" or "ask-o11y"

### MCP Server Connection Errors

1. Verify the Grafana MCP plugin is installed (search "Grafana MCP" in plugin catalog)
2. Check your service account exists and has a valid token under **Configuration → Service Accounts**
3. In **Configuration → Plugins → Ask O11y → Configuration**, verify:
   - URL: `https://<your-instance>.grafana.net/api/plugins/grafana-mcp-app/resources/mcp`
   - Type: `streamable-http`
   - Authorization header is set with your token
4. Health status should show **Healthy**

### Visualization Not Displaying

1. Check datasources exist and pass "Save & test" under **Connections → Data sources**
2. Try a wider time range—some metrics may not have recent data
3. Switch to Table view to check if data is returned at all

### Permission Errors

- **Viewer**: Read-only operations only (query, list, get, search)
- **Editor/Admin**: Full access
- Check you're in the correct organization (top-left org switcher)

### Session Sharing Issues

1. Check the share link hasn't expired
2. Shares are scoped to the organization where created
3. Rate limit: 50 shares per hour per user
4. Creator may have revoked the link

---

## Self-Hosted / Docker Users

### Plugin Not Appearing

1. Verify the plugin directory exists:
   ```bash
   ls /var/lib/grafana/plugins/consensys-asko11y-app/
   ```

2. Check Grafana logs:
   ```bash
   docker logs grafana 2>&1 | grep -i ask-o11y
   ```

3. Restart Grafana:
   ```bash
   docker compose restart grafana
   ```

### LLM Not Responding

1. Verify the Grafana LLM plugin is installed:
   ```bash
   grafana-cli plugins list | grep llm
   ```

2. Check AI provider connectivity from the Grafana host:
   ```bash
   curl https://api.openai.com/v1/models -H "Authorization: Bearer $YOUR_KEY"
   ```

3. Check logs:
   ```bash
   docker logs grafana 2>&1 | grep -i llm
   ```

### MCP Server Connection Errors

1. Verify MCP server is running:
   ```bash
   docker ps | grep mcp-grafana
   ```

2. Ensure service account feature toggles are enabled:
   ```yaml
   environment:
     - GF_FEATURE_TOGGLES_ENABLE=externalServiceAccounts
     - GF_AUTH_MANAGED_SERVICE_ACCOUNTS_ENABLED=true
   ```
   Restart Grafana after changing these.

3. Verify your service account token under **Configuration → Service Accounts** (tokens can't be retrieved—create a new one if lost)

4. Test MCP connectivity:
   ```bash
   docker exec grafana curl http://mcp-grafana:8000/mcp/health
   ```

5. Check containers are on the same Docker network:
   ```bash
   docker network inspect <your-network-name>
   ```

6. In Ask O11y configuration, verify the URL is accessible from the Grafana container:
   - Docker: `http://mcp-grafana:8000/mcp` or `http://grafana:3000/api/plugins/grafana-mcp-app/resources/mcp`
   - Local: `http://localhost:3000/api/plugins/grafana-mcp-app/resources/mcp`

### Visualization Not Displaying

1. Test datasource connectivity:
   ```bash
   curl http://prometheus:9090/api/v1/query?q=up
   curl http://loki:3100/loki/api/v1/labels
   ```

2. Click "Save & test" on each datasource under **Connections → Data sources**

3. Start with a simple query like "Show me a simple metric" to isolate the issue

### Permission Errors

1. Check user role under **Administration → Users and access**
2. Check the MCP service account has the appropriate role (Editor or Admin for full access)
3. Check datasource-level permissions

### Session Storage Issues

Sessions are stored in-memory by default and lost on restart. For persistence, configure Redis:

```yaml
# In docker-compose.yaml
environment:
  - GF_PLUGIN_ASKO11Y_REDIS=redis://redis:6379/0
```

To free space, delete old sessions from the sidebar or export them first.

### Build or Development Issues

1. Check versions: Node.js >= 22, Go >= 1.21
2. Clean rebuild:
   ```bash
   rm -rf node_modules package-lock.json dist
   npm install
   npm run build
   ```
3. Check port 3000 isn't already in use: `lsof -i :3000`

---

## Common Issues (All Deployments)

### "Generating" Indicator Stuck

1. Refresh the page
2. Check browser console for errors
3. Verify your LLM provider is responding
4. Check Grafana logs for backend errors

### Share Link Not Working

1. Check if the link has expired
2. Ensure you're in the same organization where the share was created
3. The creator may have revoked the link
4. For self-hosted: check Grafana logs (`docker logs grafana | grep -i share`)

---

## Getting Help

### Enable Debug Logging

```yaml
# In docker-compose.yaml or grafana.ini
environment:
  - GF_LOG_LEVEL=debug
  - GF_LOG_FILTERS=plugins.consensys-asko11y-app:debug
```

### Bug Reports

When reporting issues on [GitHub](https://github.com/Consensys/ask-o11y-plugin/issues), include:

1. **Deployment type**: Grafana Cloud or Self-Hosted
2. **Versions**: Grafana, Ask O11y plugin, Grafana LLM plugin
3. **Error messages**: Exact text + browser console errors + Grafana log excerpts
4. **Steps to reproduce**: Numbered steps with expected vs actual behavior
5. **Configuration**: MCP server config (redact tokens), datasource types, user role

### Contact

- **Bug Reports**: [GitHub Issues](https://github.com/Consensys/ask-o11y-plugin/issues)
- **Questions**: [GitHub Discussions](https://github.com/Consensys/ask-o11y-plugin/discussions)
- **Security**: GitHub Security Advisory (private disclosure)

---

## Quick Reference

| Issue | Grafana Cloud | Self-Hosted |
|-------|---------------|-------------|
| Service Account | Enabled by default | Must enable feature toggle |
| MCP URL | `https://<instance>.grafana.net/...` | `http://grafana:3000/...` |
| Logs | Grafana Cloud UI | `docker logs grafana` |
| Session Storage | Managed | In-memory (default) or Redis |
| Updates | Automatic | Manual plugin update |
