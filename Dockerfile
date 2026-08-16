FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 5500
ENV PORT=5500
USER node
CMD ["node", "src/index.js"]
