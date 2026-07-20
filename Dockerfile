FROM node:20-alpine

# Install bash and git since the scripts depend on them
RUN apk add --no-cache bash git

WORKDIR /app

# Copy the package.json first to cache dependencies (if any)
COPY package.json ./

# Copy all the repository contents
COPY . .

# Make the verify script executable
RUN chmod +x docker-verify.sh

# Define default command
CMD ["./docker-verify.sh"]
