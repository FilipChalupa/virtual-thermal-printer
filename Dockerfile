FROM denoland/deno:alpine AS builder

WORKDIR /app

# Cache dependencies
COPY deno.json deno.lock ./
RUN deno install

COPY . .

# Build the frontend
RUN deno task build

FROM denoland/deno:alpine

WORKDIR /app

# Copy the built dist and necessary files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/deno.json ./deno.json
COPY --from=builder /app/main.ts ./main.ts
COPY --from=builder /app/escpos.ts ./escpos.ts
COPY --from=builder /app/escpos-transform.ts ./escpos-transform.ts
COPY --from=builder /app/shared ./shared

# Pre-cache runtime dependencies
RUN deno install

# Expose HTTP and ESC/POS socket ports
EXPOSE 80
EXPOSE 9100

# Run the server
# We use the default ports 80 and 9100 as defined in main.ts
CMD ["run", "--allow-net", "--allow-read", "--allow-env", "main.ts"]
