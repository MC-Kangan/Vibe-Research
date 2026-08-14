FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./
COPY market_data/ ./market_data/
COPY api/ ./api/
COPY news_sources.json ./

RUN groupadd --gid 10001 vibe \
    && useradd --uid 10001 --gid vibe --no-create-home --shell /usr/sbin/nologin vibe \
    && mkdir -p /data/myreports \
    && chown -R vibe:vibe /app /data

USER vibe

EXPOSE 8900

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8900/api/health', timeout=3).read()"]

CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8900", "--no-access-log"]
