# dind-box Docker image (Issue #80)
#
# Adds a working Docker Engine (dockerd + CLI + containerd + Buildx + Compose)
# on top of any existing box image. Generic by design: pass any of the project's
# images as BASE_IMAGE and you get a "<base>-dind" variant.
#
#   docker build -f ubuntu/24.04/dind/Dockerfile \
#     --build-arg BASE_IMAGE=konard/box:latest \
#     -t konard/box-dind .
#
#   docker build -f ubuntu/24.04/dind/Dockerfile \
#     --build-arg BASE_IMAGE=konard/box-python:latest \
#     -t konard/box-python-dind .
#
# Run (default):     docker run --privileged konard/box-dind
# Run (Sysbox/safe): docker run --runtime=sysbox-runc konard/box-dind
#
# Each running dind-box has its own inner dockerd. `docker ps -a` from inside
# the container therefore only lists containers created by *this* box, which
# satisfies the host-isolation stretch goal in issue #80.
#
# See docs/case-studies/issue-80/CASE-STUDY.md for the full design rationale.

ARG BASE_IMAGE=konard/box:latest
FROM ${BASE_IMAGE}

USER root
ENV DEBIAN_FRONTEND=noninteractive

# Marker that bakes which base image this dind variant was layered on.
# Used by tests and by the README size table.
ARG BASE_IMAGE
ENV BOX_DIND_BASE_IMAGE=${BASE_IMAGE}

# Copy install layer
COPY ubuntu/24.04/common.sh /tmp/common.sh
COPY ubuntu/24.04/dind/install.sh /tmp/install.sh
COPY ubuntu/24.04/dind/dind-entrypoint.sh /tmp/dind-entrypoint.sh

RUN chmod +x /tmp/install.sh /tmp/common.sh /tmp/dind-entrypoint.sh && \
    bash /tmp/install.sh && \
    rm -f /tmp/install.sh /tmp/common.sh /tmp/dind-entrypoint.sh

# Sanity: docker, dockerd, buildx, compose must all be present.
RUN docker --version && \
    dockerd --version && \
    docker buildx version && \
    docker compose version

# Keep WORKDIR consistent with the rest of the box images.
WORKDIR /home/box

SHELL ["/bin/bash", "-c"]

# IMPORTANT: dind-entrypoint.sh starts dockerd as root and then drops to box
# via runuser/su. Do not switch back to USER box here.
ENTRYPOINT ["/usr/local/bin/dind-entrypoint.sh"]
CMD ["/bin/bash"]
