FROM node:20-bookworm-slim

# System packages needed by Playwright/Chromium
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

# Install Playwright Chromium + all OS-level dependencies
RUN npx playwright install chromium --with-deps

# Copy source and build
COPY . .

# Build: provider 전환 → prisma generate → next build
RUN npm run build

# Ensure screenshot / data dirs exist
RUN mkdir -p public/screenshots data public/reports

ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

EXPOSE 3000

# 시작: provider 전환 → db push → next start (exec으로 직접 실행해 signal 정상 전달)
CMD ["sh", "-c", "node scripts/prisma-setup.js && npx prisma db push --accept-data-loss && exec node_modules/.bin/next start"]
