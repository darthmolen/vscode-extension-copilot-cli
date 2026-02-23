# Dockerfile for CLI auto-update experiments
#
# Build:  docker build -t cli-spike .
# Run:    docker run --rm -e GITHUB_TOKEN=$GITHUB_TOKEN cli-spike
# Single: docker run --rm -e GITHUB_TOKEN=$GITHUB_TOKEN cli-spike ./experiment-4.sh

FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /spike
COPY verify.sh experiment-*.mjs experiment-*.sh run-all.sh ./
RUN chmod +x *.sh

CMD ["./run-all.sh"]
