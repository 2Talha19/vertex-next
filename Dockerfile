# ---- Stage 1: dependencies ----
FROM node:22-alpine AS deps
WORKDIR /app
# package-lock.json is committed, so npm ci installs exact versions
COPY package.json package-lock.json ./
RUN npm ci

# ---- Stage 2: build ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Env vars are injected at runtime by the host (Coolify) — the build does not
# need them because the page is a client component and API routes read env at
# request time.
RUN npm run build

# ---- Stage 3: runtime ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Static assets the standalone server serves
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# The standalone server (server.js) + minimal node_modules + traced files
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# Healthcheck — / returns 200 even logged-out (auth screen)
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
