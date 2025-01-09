FROM node:20.14.0-alpine AS development
ENV NODE_ENV=development
WORKDIR /app
COPY ./package*.json ./
RUN npm install
COPY ./ ./
CMD ["npm", "run", "dev"]

FROM node:20.14.0-alpine AS production
ENV NODE_ENV=production
WORKDIR /app
COPY ./package*.json ./
RUN npm install
COPY ./ ./
CMD ["npm", "run", "start"]