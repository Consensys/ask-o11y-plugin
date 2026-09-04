# Builds the Graphiti MCP server from source instead of consuming
# zepai/knowledge-graph-mcp:1.1.0-standalone, which bakes in the mcp_server
# "providers" and "azure" extras (anthropic/groq/voyageai/google-genai and,
# via sentence-transformers, PyTorch) regardless of which provider is
# actually configured. We only ever use provider: "openai" (routed through
# litellm — see provisioning/.config/graphiti.yaml), which is a base
# dependency needing none of that, so building without those extras drops
# the image from ~6.4GB back to roughly its original ~200MB.
FROM python:3.11-slim-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    && rm -rf /var/lib/apt/lists/*

ADD https://astral.sh/uv/install.sh /uv-installer.sh
RUN sh /uv-installer.sh && rm /uv-installer.sh
ENV PATH="/root/.local/bin:${PATH}"

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    MCP_SERVER_HOST="0.0.0.0" \
    PYTHONUNBUFFERED=1

WORKDIR /app/mcp

# Pins graphiti-core (via pyproject.toml, below) and the mcp_server source
# tree (via git clone) to the same release train.
ARG GRAPHITI_CORE_VERSION=0.30.1
ARG MCP_SERVER_REF=mcp-v1.1.0

RUN git clone --depth 1 --branch ${MCP_SERVER_REF} https://github.com/getzep/graphiti.git /tmp/graphiti \
    && cp -r /tmp/graphiti/mcp_server/. /app/mcp/ \
    && rm -rf /tmp/graphiti /app/mcp/tests \
    && echo "3.11" > /app/mcp/.python-version

# Remove the local path override for graphiti-core, pin to the PyPI release
# with only the neo4j/falkordb graph-driver extras, and regenerate the lock
# file against that — mirrors getzep's own Dockerfile.standalone, minus the
# --extra providers --extra azure flags that pull in the unused SDKs/PyTorch.
RUN sed -i '/\[tool\.uv\.sources\]/,/graphiti-core/d' pyproject.toml \
    && sed -i "s/graphiti-core\[falkordb\][>=]\+[0-9]\+\.[0-9]\+\.[0-9]\+/graphiti-core[neo4j,falkordb]==${GRAPHITI_CORE_VERSION}/" pyproject.toml \
    && rm -f uv.lock \
    && uv lock

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-group dev

RUN groupadd --system --gid 1000 graphiti \
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

EXPOSE 8000
CMD ["uv", "run", "--no-sync", "main.py"]
