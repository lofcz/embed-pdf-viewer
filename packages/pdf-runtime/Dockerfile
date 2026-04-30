# syntax=docker/dockerfile-upstream:master-labs
FROM emscripten/emsdk:3.1.70 AS base

ARG DEBIAN_FRONTEND=noninteractive

ENV PATH="/emsdk/upstream/bin:${PATH}"

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      autoconf \
      automake \
      build-essential \
      curl \
      git \
      libtool \
      lsb-release \
      pkg-config \
      python3 \
      rsync \
      subversion \
      tini \
      yasm && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

RUN git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git \
      -b main /opt/depot-tools

ENV PATH="${PATH}:/opt/depot-tools"

RUN curl -sSf https://sh.rustup.rs | bash -s -- -y && \
    . "$HOME/.cargo/env" && \
    cargo install --locked watchexec-cli && \
    strip "$HOME/.cargo/bin/watchexec" && \
    rm -rf "$HOME/.cargo/registry" "$HOME/.cargo/git"

ENV PATH="$HOME/.cargo/bin:${PATH}"

WORKDIR /workspace

ENTRYPOINT ["/usr/bin/tini", "--"]
