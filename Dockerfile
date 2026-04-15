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

RUN npx prisma generate

RUN npm run build

# Ensure screenshot / data dirs exist
RUN mkdir -p public/screenshots data public/reports

ENV NODE_ENV=production
ENV PLAYWRIGHT_HEADLESS=true

EXPOSE 3000

# Railway injects $PORT — Next.js 14 reads it natively
CMD ["npm", "start"]
