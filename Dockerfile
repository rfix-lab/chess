FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# F1: create the data dir BEFORE the volume is bound, owned by the runtime
# user — otherwise docker creates it as root and USER node cannot write users.csv.
RUN mkdir -p /app/data && chown node:node /app/data
EXPOSE 5500
ENV PORT=5500
USER node
CMD ["node", "src/index.js"]
