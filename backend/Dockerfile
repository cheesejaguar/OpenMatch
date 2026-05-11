FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json ./backend/
COPY matching/package.json ./matching/
RUN npm install --ignore-scripts

FROM node:26-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema backend/prisma/schema.prisma \
  && npm run build -w @openmatch/matching \
  && npm run build -w @openmatch/backend

FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/matching/dist ./matching/dist
COPY --from=build /app/matching/algorithm_config.json ./matching/algorithm_config.json
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/matching/package.json ./matching/package.json
COPY --from=build /app/package.json ./package.json
EXPOSE 8080
CMD ["node", "backend/dist/server.js"]
