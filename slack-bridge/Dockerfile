# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache tini

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
