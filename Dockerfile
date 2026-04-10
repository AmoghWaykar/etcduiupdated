# ─────────────────────────────────────────────
# Stage 1: Build the Angular app
# ─────────────────────────────────────────────
FROM node:20-alpine AS builder

# JFrog Artifactory npm registry credentials
# Pass these at build time:
#   docker build \
#     --build-arg JFROG_URL=https://your-company.jfrog.io/artifactory/api/npm/npm-repo/ \
#     --build-arg JFROG_USER=your-username \
#     --build-arg JFROG_PASSWORD=your-password \
#     -t etcd-dashboard .
ARG JFROG_URL
ARG JFROG_USER
ARG JFROG_PASSWORD

WORKDIR /app

# Configure npm to use JFrog Artifactory if credentials are provided
RUN if [ -n "$JFROG_URL" ] && [ -n "$JFROG_USER" ] && [ -n "$JFROG_PASSWORD" ]; then \
      JFROG_HOST=$(echo "$JFROG_URL" | sed 's|https://||' | sed 's|http://||' | cut -d'/' -f1) && \
      npm config set registry "$JFROG_URL" && \
      npm config set "//${JFROG_HOST}/:username" "$JFROG_USER" && \
      npm config set "//${JFROG_HOST}/:_password" "$(echo -n $JFROG_PASSWORD | base64)" && \
      npm config set "//${JFROG_HOST}/:always-auth" "true" && \
      echo "✅ JFrog Artifactory registry configured: $JFROG_URL"; \
    else \
      echo "ℹ️  No JFrog credentials provided — using default npmjs.org registry"; \
    fi

# Copy dependency files first (layer cache optimisation)
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci --prefer-offline

# Copy the rest of the source
COPY . .

# Build for production
RUN npm run build -- --configuration production

# ─────────────────────────────────────────────
# Stage 2: Serve with nginx
# ─────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

# Remove default nginx static content
RUN rm -rf /usr/share/nginx/html/*

# Copy built Angular app from Stage 1
# Angular 17+ outputs to dist/<project-name>/browser
COPY --from=builder /app/dist/etcd-dashboard/browser /usr/share/nginx/html

# Copy custom nginx config (handles Angular routing + proxy to etcd)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
