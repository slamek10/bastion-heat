# same two-stage shape as bastion-ha and bastion-cams: build natively, run on alpine
FROM --platform=$BUILDPLATFORM node:22 AS builder
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server.js /app/auth.js /app/package.json ./

ENV PORT=5090 \
  NODE_ENV=production \
  BODY_SIZE_LIMIT=1M

EXPOSE 5090
CMD ["node", "server.js"]
