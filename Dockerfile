# One image: the Expo web build served by the FastAPI backend on port 8000.
# Build:  docker build -t homebridge .
# Run:    docker run -p 8000:8000 -e LLM_PROVIDER=deepseek -e LLM_API_KEY=sk-... homebridge

FROM node:20-slim AS web
WORKDIR /app
COPY app/package.json app/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY app/ ./
RUN npx expo export --platform web

FROM python:3.11-slim
WORKDIR /srv/backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
COPY --from=web /app/dist /srv/app/dist
ENV HB_WEB_DIR=/srv/app/dist \
    HB_AUDIT=/srv/backend/var/audit.jsonl \
    PYTHONUNBUFFERED=1
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
