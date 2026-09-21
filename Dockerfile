FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lock* /app/
RUN bun install --frozen-lockfile --production
COPY . /app
CMD ["bun","run","app/index.ts"]
