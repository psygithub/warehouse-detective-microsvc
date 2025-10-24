# Use the official Playwright image to ensure all dependencies are met
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy the rest of the application source code
COPY . .

# Expose the port the service will run on
EXPOSE 3001

# Command to run the application
CMD ["node", "src/server.js"]
