FROM node:20-slim AS builder

WORKDIR /app

# Copy root workspace target artifacts needed for IDLs and types
COPY target/ /app/target/

# Copy backend package manifests and source
COPY backend/package*.json ./backend/
COPY backend/tsconfig.json ./backend/

WORKDIR /app/backend
RUN npm ci || npm install

COPY backend/src ./src
RUN npm run build

# Production runtime stage
FROM node:20-slim AS runner

WORKDIR /app

# Install curl for health checks
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target /app/target
COPY --from=builder /app/backend/package*.json /app/backend/
COPY --from=builder /app/backend/dist /app/backend/dist
COPY --from=builder /app/backend/node_modules /app/backend/node_modules

WORKDIR /app/backend

EXPOSE 3000

ENV PORT=3000
ENV RELAYER_PORT=3000
ENV RPC_URL=http://solana-test-validator:8899

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
