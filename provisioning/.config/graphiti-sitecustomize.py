# Patch FastMCP to allow Docker service hostname in Host header.
# Mounted as sitecustomize.py so it runs before graphiti_mcp_server.py imports FastMCP.
try:
    from mcp.server.fastmcp import server as _fm

    _orig = _fm.FastMCP.__init__

    def _patched(self, *args, **kwargs):
        _orig(self, *args, **kwargs)
        ts = getattr(self.settings, "transport_security", None)
        if ts is not None:
            ts.allowed_hosts.extend(["graphiti:*", "graphiti"])

    _fm.FastMCP.__init__ = _patched
except Exception:
    pass
