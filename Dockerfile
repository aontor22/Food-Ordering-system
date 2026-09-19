FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
COPY front-end/package*.json front-end/
COPY server/package*.json server/
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 4000
CMD ["sh", "-c", "npm run db:setup && npm start"]
