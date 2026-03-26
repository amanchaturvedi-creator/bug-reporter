# Deploy from repo root: builds the Nest backend in ./backend
FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./
COPY backend/prisma ./prisma/

RUN npm ci

COPY backend/ ./

RUN npx prisma generate && npm run build

RUN npm prune --omit=dev

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
