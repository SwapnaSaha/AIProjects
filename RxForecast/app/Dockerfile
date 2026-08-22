FROM node:20-alpine
WORKDIR /app

# Copy the entire app directory (frontend + backend)
COPY . .

# Build frontend
WORKDIR /app/frontend
RUN npm install
RUN npm run build

# Install backend dependencies
WORKDIR /app/backend
RUN npm install

# Set working directory to backend for startup
WORKDIR /app/backend

# Expose backend port
EXPOSE 4000

# Start the backend server
CMD ["npm", "start"]
