FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9
ADD https://codeload.github.com/MatrAIx-ai/Personal-Agents-Last-Exam/tar.gz/7a05aa958c824143ab9eee1aa21c2dfacd8be31a /tmp/pale.tgz
RUN echo "aa0de43bd1a3393e87a9fb5bc5bfe304c1a6957da6a257fe194113f38aeff91e  /tmp/pale.tgz" | sha256sum -c - && mkdir -m 700 /opt/pale /opt/packet && tar -xzf /tmp/pale.tgz --strip-components=1 -C /opt/pale && rm /tmp/pale.tgz
COPY context/ /opt/packet/task/context/
COPY environment/workspace/ /opt/packet/task/environment/workspace/
COPY environment/adapter/ /opt/packet/task/environment/adapter/
COPY environment/packet.cjs /usr/local/lib/packet.cjs
RUN chmod 700 /opt/pale /opt/packet && chmod 755 /usr/local/lib/packet.cjs && ln -s /usr/local/lib/packet.cjs /usr/local/bin/packet && install -d -o node -g node /work
WORKDIR /work
ENTRYPOINT ["node", "/opt/packet/task/environment/adapter/server.cjs"]
