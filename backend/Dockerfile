# Production image (Railway / VPS). Root directory in Railway: set to `backend` if repo is monorepo.
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate && npm run build

# Drop dev-only tooling if any are later moved to devDependencies
RUN npm prune --omit=dev

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
