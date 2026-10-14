# Issue #3214 experiment image: a small box-dind variant with the same
# stale-pid cleanup layers as the end of Dockerfile.dind. Build from the
# repository root:
#   docker build -f experiments/issue-3214/Dockerfile -t hive-mind-dind-3214 .
ARG BASE_IMAGE=ghcr.io/link-foundation/box-essentials-dind:2.10.4
FROM ${BASE_IMAGE}
COPY --chmod=0755 scripts/dind/clear-stale-dind-pids.sh /usr/local/sbin/hive-mind-dind-clear-stale-pids
COPY --chmod=0755 scripts/dind/hive-mind-dind-entrypoint.sh /usr/local/bin/hive-mind-dind-entrypoint.sh
COPY --chmod=0440 scripts/dind/hive-mind-dind.sudoers /etc/sudoers.d/hive-mind-dind
RUN sudo -n /usr/local/sbin/hive-mind-dind-clear-stale-pids
ENTRYPOINT ["/usr/local/bin/hive-mind-dind-entrypoint.sh"]
CMD ["/bin/bash"]
