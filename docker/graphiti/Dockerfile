FROM zepai/knowledge-graph-mcp:standalone
RUN pip install --no-cache-dir --target=/app/mcp/.venv/lib/python3.11/site-packages anthropic \
    && groupadd --system --gid 1000 graphiti \
    && useradd --system --uid 1000 --gid graphiti --home-dir /tmp --shell /usr/sbin/nologin graphiti \
    && cp /root/.local/bin/uv /usr/local/bin/uv \
    && cp /root/.local/bin/uvx /usr/local/bin/uvx \
    && chown -R 1000:1000 /app/mcp

ENV HOME=/tmp \
    UV_CACHE_DIR=/tmp/uv-cache \
    UV_COMPILE_BYTECODE=0 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH=/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin

USER 1000:1000
