FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci \
  && npx playwright install --with-deps chromium \
  && npm cache clean --force

COPY . .
RUN npm run build

VOLUME ["/app/reports"]
EXPOSE 3000

CMD ["npm", "run", "start"]
