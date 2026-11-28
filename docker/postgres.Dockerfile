# syntax=docker/dockerfile:1

# Postgres 18 (Alpine, like before) with pgvector, for the search index over fragments.
FROM postgres:19-alpine AS build
ARG PGVECTOR_VERSION=0.8.1
RUN apk add --no-cache build-base curl
RUN curl -fsSL "https://github.com/pgvector/pgvector/archive/refs/tags/v${PGVECTOR_VERSION}.tar.gz" | tar xz -C /tmp \
  && cd "/tmp/pgvector-${PGVECTOR_VERSION}" \
  && make OPTFLAGS="" with_llvm=no \
  && make install with_llvm=no DESTDIR=/out

FROM postgres:19-alpine
COPY --from=build /out/usr/local/ /usr/local/
