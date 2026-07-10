FROM node:18-alpine

WORKDIR /app

# Copy dependency manifest first (layer cache optimisation)
COPY package.json .

# Install production dependencies only
RUN npm install --omit=dev

# Copy source
COPY . .

# Non-root user for security
RUN addgroup -S hl7 && adduser -S hl7 -G hl7
USER hl7

EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health',r=>{process.exit(r.statusCode===200?0:1)})"

CMD ["node", "index.js"]
