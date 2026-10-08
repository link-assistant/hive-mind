ARG JS_IMAGE=konard/box-js:latest
FROM ${JS_IMAGE}
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Essentials Box Docker image
# Built on top of the JS box, adds git identity tools (gh, glab)
# Published as: konard/box-essentials
#
# Build from repository root:
#   docker build -f ubuntu/24.04/essentials-box/Dockerfile -t box-essentials .
#
# Build with specific JS image:
#   docker build -f ubuntu/24.04/essentials-box/Dockerfile \
#     --build-arg JS_IMAGE=konard/box-js:latest -t box-essentials .

USER root

ENV DEBIAN_FRONTEND=noninteractive

# Copy install script
COPY ubuntu/24.04/common.sh /tmp/common.sh
COPY ubuntu/24.04/essentials-box/install.sh /tmp/install.sh
COPY scripts/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /tmp/install.sh /tmp/common.sh /usr/local/bin/entrypoint.sh && \
    DOCKER_BUILD=1 bash /tmp/install.sh && \
    rm -f /tmp/install.sh

COPY ubuntu/24.04/common.sh /tmp/common.sh

# Install ACL support for shared group permissions on /home/box
RUN . /tmp/common.sh && \
    apt_update_with_retry && \
    apt-get install -y --no-install-recommends acl && \
    apt-get clean && rm -rf /var/lib/apt/lists/* && \
    rm -f /tmp/common.sh && \
    setfacl -R -m g:box:rwx /home/box && \
    setfacl -d -m g:box:rwx /home/box

USER box
WORKDIR /home/box

# Environment variables inherited from JS box base image
# Additional ones for essentials are not needed (gh, glab are system-wide)

SHELL ["/bin/bash", "-c"]

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/bin/bash"]
