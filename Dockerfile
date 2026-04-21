FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build

FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/main.ts ./main.ts
COPY --from=builder /app/escpos.ts ./escpos.ts
COPY --from=builder /app/escpos-transform.ts ./escpos-transform.ts
COPY --from=builder /app/shared ./shared

EXPOSE 80
EXPOSE 9100

CMD ["npm", "start"]
