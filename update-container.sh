#!/bin/bash
# Script to update Sappho container with latest GitHub image

echo "🔄 Updating Sappho container..."

# Stop and remove existing container
echo "⏹️  Stopping existing container..."
docker-compose down

# Pull latest image from GitHub Container Registry
echo "📦 Pulling latest image from ghcr.io..."
docker pull ghcr.io/mondominator/sappho:latest

# Remove old images (optional)
echo "🗑️  Cleaning up old images..."
docker image prune -f

# Start container with new image
echo "🚀 Starting updated container..."
docker-compose up -d

# Show logs
echo "📋 Container logs:"
docker-compose logs --tail=50

echo "✅ Update complete!"
echo "📊 Current image digest:"
docker inspect ghcr.io/mondominator/sappho:latest --format='{{index .RepoDigests 0}}'
